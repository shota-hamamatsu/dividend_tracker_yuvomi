import {
    buildPayments,
    buildYearlyTotal,
    parseShares,
    parseYear,
    validateInput,
    type Currency,
    type CurrencyBreakdown,
    type DividendRecord,
    type OwnerTotal,
    type RecordInput,
    type YearlyTotal,
} from '../src/logic.ts';

export const SCENARIOS = ['admin', 'member', 'viewer', 'empty', 'error', 'slow'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const BASE = '/api/extensions/dividend-tracker';
const ENDPOINT = `${BASE}/records`;
const YEARLY_ENDPOINT = `${BASE}/yearly-totals`;
const TOKEN = 'dev-token';
const NOT_FOUND = { error: 'Record not found.', code: 'record_not_found' };

const rec = (
    id: string,
    ownerId: number,
    ticker: string,
    name: string,
    shares: number,
    payments: [payDate: string, perShareText: string][],
    currency: Currency = 'JPY',
): DividendRecord => ({
    id,
    ownerId,
    currency,
    ticker,
    name,
    shares,
    payments: buildPayments(
        shares,
        payments.map(([payDate, perShareText]) => ({ payDate, perShareText })),
        currency,
    ),
    createdBy: ownerId,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
});

const seed = (): DividendRecord[] => [
    rec('1', 1, '7203', 'トヨタ自動車', 100, [
        ['06-02', '50'],
        ['11-26', '45'],
    ]),
    rec('2', 2, '9432', 'NTT', 1000, [
        ['06-23', '2.65'],
        ['12-09', '2.6'],
    ]),
    rec('3', 3, '8058', '三菱商事', 200, [
        ['03-31', '56'],
        ['09-30', '60'],
    ]),
    rec('4', 2, '8306', '三菱UFJ', 300, [['06-27', '32.5']]),
    rec(
        '5',
        1,
        'AAPL',
        'Apple',
        50,
        [
            ['02-13', '0.26'],
            ['05-15', '0.26'],
            ['08-14', '0.26'],
            ['11-13', '0.26'],
        ],
        'USD',
    ),
];

const breakdown = (currency: Currency, owners: OwnerTotal[]): CurrencyBreakdown => ({
    currency,
    total: owners.reduce((sum, o) => sum + o.total, 0),
    owners,
});

/**
 * 過去の年の登録済み合計（今年の 1〜5 年前）。保有者 3 は 3 年前から。
 * USD（1/100 ドル単位）は保有者 1 の 2 年前・1 年前だけ。
 */
const USD_BY_AGO: Record<number, number> = { 2: 4800, 1: 5200 };

const seedYearlyTotals = (): YearlyTotal[] => {
    const thisYear = new Date().getFullYear();
    return [5, 4, 3, 2, 1].map((ago) => {
        const yen = breakdown('JPY', [
            { ownerId: 1, total: 9000 - ago * 200 },
            { ownerId: 2, total: 12000 - ago * 500 },
            ...(ago <= 3 ? [{ ownerId: 3, total: 20000 - ago * 1500 }] : []),
        ]);
        const usd = USD_BY_AGO[ago];
        return {
            year: thisYear - ago,
            totals: usd ? [yen, breakdown('USD', [{ ownerId: 1, total: usd }])] : [yen],
            registeredBy: 1,
            registeredAt: `${thisYear - ago}-12-31T00:00:00.000Z`,
        };
    });
};

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) return abort();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                abort();
            },
            { once: true },
        );
    });

const realFetch = window.fetch.bind(window);

export function installMockFetch(scenario: Scenario): void {
    const records = scenario === 'empty' ? [] : seed();
    let yearlyTotals = scenario === 'empty' ? [] : seedYearlyTotals();
    let nextId = records.length + 1;
    const me = {
        id: scenario === 'member' || scenario === 'viewer' ? 2 : 1,
        isAdmin: scenario !== 'member' && scenario !== 'viewer',
        canWrite: scenario !== 'viewer',
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(`${BASE}/`)) return realFetch(input, init);
        const signal = init?.signal ?? undefined;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const method = init?.method ?? 'GET';

        if (method === 'GET') {
            if (scenario === 'slow') await sleep(2000, signal);
            if (scenario === 'error') {
                return json(500, { error: 'A server error occurred.', code: 'internal' });
            }
            return json(200, { data: records, yearlyTotals, me, csrfToken: TOKEN });
        }

        const headers = new Headers(init?.headers);
        if (headers.get('X-DT-CSRF') !== TOKEN) {
            return json(403, { error: 'Reload the page and try again.', code: 'csrf' });
        }
        if (!me.canWrite) {
            return json(403, { error: 'You have view-only access.', code: 'read_only' });
        }

        if (url.startsWith(`${YEARLY_ENDPOINT}/`)) {
            const year = parseYear(decodeURIComponent(url.slice(YEARLY_ENDPOINT.length + 1)));
            if (year === null) {
                return json(400, {
                    error: 'Enter a year from 2000 to 2100.',
                    code: 'invalid_year',
                    params: { min: 2000, max: 2100 },
                });
            }
            const total = buildYearlyTotal(records, year, me.id, new Date().toISOString());
            yearlyTotals = [...yearlyTotals.filter((t) => t.year !== year), total].sort(
                (a, b) => a.year - b.year,
            );
            return json(200, { data: total });
        }

        if (method === 'DELETE') {
            const id = decodeURIComponent(url.slice(ENDPOINT.length + 1));
            const index = records.findIndex((r) => r.id === id);
            const current = records[index];
            if (!current) return json(404, NOT_FOUND);
            if (!me.isAdmin && current.ownerId !== me.id) {
                return json(403, {
                    error: "Only admins can delete other people's records.",
                    code: 'not_owner_delete',
                });
            }
            records.splice(index, 1);
            return json(200, { data: { id, deleted: true } });
        }

        const parsed = JSON.parse(String(init?.body ?? '{}')) as Partial<RecordInput>;
        // 省略時は JPY（サイドカーと同じ）
        const body = { ...parsed, currency: parsed.currency ?? 'JPY' } as RecordInput;
        const error = validateInput(body);
        // 英語の文はサイドカーと違い省略する（画面は code で翻訳する）
        if (error !== null) return json(400, { error: error.code, ...error });
        if (!me.isAdmin && body.ownerId !== me.id) {
            return json(403, {
                error: 'Only admins can add records for other people.',
                code: 'not_owner_add',
            });
        }
        const shares = parseShares(body.sharesText) as number;
        const currency = body.currency as Currency;
        const fields = {
            ownerId: body.ownerId,
            currency,
            ticker: body.ticker.trim(),
            name: body.name.trim(),
            shares,
            payments: buildPayments(shares, body.payments, currency),
        };
        const now = new Date().toISOString();

        if (method === 'PUT') {
            const id = decodeURIComponent(url.slice(ENDPOINT.length + 1));
            const index = records.findIndex((r) => r.id === id);
            const current = records[index];
            if (!current) return json(404, NOT_FOUND);
            if (!me.isAdmin && current.ownerId !== me.id) {
                return json(403, {
                    error: "Only admins can edit other people's records.",
                    code: 'not_owner_edit',
                });
            }
            const record: DividendRecord = { ...current, ...fields, updatedAt: now };
            records[index] = record;
            return json(200, { data: record });
        }

        const record: DividendRecord = {
            id: String(nextId++),
            ...fields,
            createdBy: me.id,
            createdAt: now,
            updatedAt: now,
        };
        records.push(record);
        return json(201, { data: record });
    };
}

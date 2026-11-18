import {
    buildPayments,
    parseShares,
    validateInput,
    type DividendRecord,
    type RecordInput,
} from '../src/logic.ts';

export const SCENARIOS = ['admin', 'member', 'viewer', 'empty', 'error', 'slow'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const ENDPOINT = '/api/extensions/dividend-tracker/records';
const TOKEN = 'dev-token';

const rec = (
    id: string,
    ownerId: number,
    ticker: string,
    name: string,
    shares: number,
    payments: [payDate: string, perShareText: string][],
): DividendRecord => ({
    id,
    ownerId,
    ticker,
    name,
    shares,
    payments: buildPayments(
        shares,
        payments.map(([payDate, perShareText]) => ({ payDate, perShareText })),
    ),
    createdBy: ownerId,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
});

const seed = (): DividendRecord[] => [
    rec('1', 1, '7203', 'トヨタ自動車', 100, [
        ['2024-06-03', '45'],
        ['2024-11-27', '45'],
        ['2025-06-02', '50'],
        ['2025-11-26', '45'],
    ]),
    rec('2', 2, '9432', 'NTT', 1000, [
        ['2024-06-24', '2.6'],
        ['2024-12-09', '2.6'],
        ['2025-06-23', '2.65'],
    ]),
    rec('3', 3, '8058', '三菱商事', 200, [
        ['2025-03-31', '56'],
        ['2025-09-30', '60'],
    ]),
    rec('4', 2, '8306', '三菱UFJ', 300, [['2025-06-27', '32.5']]),
];

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
    let nextId = records.length + 1;
    const me = {
        id: scenario === 'member' || scenario === 'viewer' ? 2 : 1,
        isAdmin: scenario !== 'member' && scenario !== 'viewer',
        canWrite: scenario !== 'viewer',
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(ENDPOINT)) return realFetch(input, init);
        const signal = init?.signal ?? undefined;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const method = init?.method ?? 'GET';

        if (method === 'GET') {
            if (scenario === 'slow') await sleep(2000, signal);
            if (scenario === 'error') return json(500, { error: '開発用: 取得エラー' });
            return json(200, { data: records, me, csrfToken: TOKEN });
        }

        const headers = new Headers(init?.headers);
        if (headers.get('X-DT-CSRF') !== TOKEN) {
            return json(403, { error: '画面を再読み込みしてから、もう一度お試しください' });
        }
        if (!me.canWrite) return json(403, { error: '書き込み権限がありません' });

        if (method === 'DELETE') {
            const id = decodeURIComponent(url.slice(ENDPOINT.length + 1));
            const index = records.findIndex((r) => r.id === id);
            const current = records[index];
            if (!current) return json(404, { error: '記録が見つかりません' });
            if (!me.isAdmin && current.ownerId !== me.id) {
                return json(403, { error: '自分の記録だけ削除できます' });
            }
            records.splice(index, 1);
            return json(200, { data: { id, deleted: true } });
        }

        const body = JSON.parse(String(init?.body ?? '{}')) as RecordInput;
        const error = validateInput(body);
        if (error !== null) return json(400, { error });
        if (!me.isAdmin && body.ownerId !== me.id) {
            return json(403, { error: '自分の記録だけ追加・編集できます' });
        }
        const shares = parseShares(body.sharesText) as number;
        const fields = {
            ownerId: body.ownerId,
            ticker: body.ticker.trim(),
            name: body.name.trim(),
            shares,
            payments: buildPayments(shares, body.payments),
        };
        const now = new Date().toISOString();

        if (method === 'PUT') {
            const id = decodeURIComponent(url.slice(ENDPOINT.length + 1));
            const index = records.findIndex((r) => r.id === id);
            const current = records[index];
            if (!current) return json(404, { error: '記録が見つかりません' });
            if (!me.isAdmin && current.ownerId !== me.id) {
                return json(403, { error: '自分の記録だけ追加・編集できます' });
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

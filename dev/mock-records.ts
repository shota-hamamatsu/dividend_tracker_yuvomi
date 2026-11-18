import { calcAmount, parsePerShare, parseShares, type DividendRecord } from '../src/logic.ts';

export const SCENARIOS = ['admin', 'member', 'viewer', 'empty', 'error', 'slow'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const ENDPOINT = '/api/extensions/dividend-tracker/records';
const TOKEN = 'dev-token';

const rec = (
    id: string,
    ownerId: number,
    ticker: string,
    name: string,
    payDate: string,
    shares: number,
    perShareCents: number,
): DividendRecord => ({
    id,
    ownerId,
    ticker,
    name,
    payDate,
    shares,
    perShareCents,
    amount: calcAmount(shares, perShareCents),
    createdBy: ownerId,
    createdAt: `${payDate}T00:00:00.000Z`,
});

const seed = (): DividendRecord[] => [
    rec('1', 1, '7203', 'トヨタ自動車', '2024-06-03', 100, 4500),
    rec('2', 2, '9432', 'NTT', '2024-09-27', 1000, 520),
    rec('3', 3, '8058', '三菱商事', '2025-03-31', 200, 5600),
    rec('4', 1, '7203', 'トヨタ自動車', '2025-06-02', 100, 4500),
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

        if ((init?.method ?? 'GET') === 'GET') {
            if (scenario === 'slow') await sleep(2000, signal);
            if (scenario === 'error') return json(500, { error: '開発用: 取得エラー' });
            return json(200, { data: records, me, csrfToken: TOKEN });
        }

        const headers = new Headers(init?.headers);
        if (headers.get('X-DT-CSRF') !== TOKEN) {
            return json(403, { error: '画面を再読み込みしてから、もう一度お試しください' });
        }
        if (!me.canWrite) return json(403, { error: '書き込み権限がありません' });
        const body = JSON.parse(String(init?.body ?? '{}')) as {
            ownerId: number;
            ticker: string;
            name: string;
            payDate: string;
            sharesText: string;
            perShareText: string;
        };
        if (!me.isAdmin && body.ownerId !== me.id) {
            return json(403, { error: '自分の記録だけ追加できます' });
        }
        const shares = parseShares(body.sharesText);
        const perShare = parsePerShare(body.perShareText);
        if (shares === null || perShare === null) {
            return json(400, { error: '入力が正しくありません' });
        }
        const record = rec(
            String(records.length + 1),
            body.ownerId,
            body.ticker,
            body.name,
            body.payDate,
            shares,
            perShare,
        );
        records.push(record);
        return json(201, { data: record });
    };
}

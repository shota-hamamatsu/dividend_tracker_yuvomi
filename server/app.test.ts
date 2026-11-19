import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler, PREFIX } from './app.ts';
import { memoryStore, type Store } from './store.ts';
import type { Me } from './yuvomi.ts';
import { parseMe } from './yuvomi.ts';
import type { DividendRecord, YearlyTotal } from '../src/logic.ts';

const ORIGIN = 'https://yuvomi.example.com';
const TOKEN = 'a'.repeat(64);

// Cookie の session=<名前> で利用者を切り替える
const USERS: Record<string, Me> = {
    admin: { id: 1, isAdmin: true, access: 'write' },
    alice: { id: 2, isAdmin: false, access: 'write' },
    reader: { id: 3, isAdmin: false, access: 'read' },
    blocked: { id: 4, isAdmin: false, access: 'none' },
};
const MEMBERS = new Set([1, 2, 3, 4]);

let store: Store;

interface ErrorBody {
    error: string;
    code: string;
    params?: Record<string, number>;
}

const errorOf = async (res: Response): Promise<ErrorBody> => (await res.json()) as ErrorBody;
let server: Server;
let base = '';

function existing(id: string, ownerId: number): DividendRecord {
    return {
        id,
        ownerId,
        currency: 'JPY',
        ticker: '7203',
        name: 'トヨタ',
        shares: 100,
        payments: [{ payDate: '03-31', perShareCents: 4500, amount: 4500 }],
        createdBy: ownerId,
        createdAt: '2025-04-01T00:00:00.000Z',
        updatedAt: '2025-04-01T00:00:00.000Z',
    };
}

before(async () => {
    server = createServer((req, res) =>
        createHandler({
            getMe: async (cookie) => {
                const name = /session=(\w+)/.exec(cookie)?.[1] ?? '';
                return USERS[name] ?? null;
            },
            getMemberIds: async () => MEMBERS,
            store,
            publicOrigin: ORIGIN,
        })(req, res),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX}`;
});

after(() => {
    server.close();
});

function reset(): void {
    store = memoryStore([existing('r-admin', 1), existing('r-alice', 2)]);
}

function write(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    user: string,
    body?: unknown,
    opts: { origin?: string; csrf?: string } = {},
): Promise<Response> {
    return fetch(`${base}${path}`, {
        method,
        headers: {
            cookie: `session=${user}; dt_csrf=${TOKEN}`,
            origin: opts.origin ?? ORIGIN,
            'x-dt-csrf': opts.csrf ?? TOKEN,
            'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const input = {
    ownerId: 2,
    ticker: ' 8306 ',
    name: ' 三菱UFJ ',
    sharesText: '3',
    payments: [
        { payDate: '12-01', perShareText: '40', amount: 999999 }, // amount は無視されるべき
        { payDate: '06-30', perShareText: '37.5' },
    ],
    amount: 999999, // 無視されるべき
};

test('authentication and module permission', async () => {
    reset();
    assert.equal((await fetch(`${base}/records`)).status, 401);
    const unknown = await fetch(`${base}/records`, { headers: { cookie: 'session=nobody' } });
    assert.equal(unknown.status, 401);
    const blocked = await fetch(`${base}/records`, { headers: { cookie: 'session=blocked' } });
    assert.equal(blocked.status, 403);
});

test('GET returns all records, me and a CSRF cookie', async () => {
    reset();
    const res = await fetch(`${base}/records`, { headers: { cookie: 'session=reader' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(
        cookie,
        /^dt_csrf=[0-9a-f]{64}; Path=\/api\/extensions\/dividend-tracker; HttpOnly; SameSite=Strict; Secure$/,
    );
    const body = (await res.json()) as {
        data: DividendRecord[];
        yearlyTotals: YearlyTotal[];
        me: unknown;
        csrfToken: string;
    };
    assert.equal(body.data.length, 2);
    assert.deepEqual(body.yearlyTotals, []);
    assert.deepEqual(body.me, { id: 3, isAdmin: false, canWrite: false });
    assert.equal(cookie.slice('dt_csrf='.length, 'dt_csrf='.length + 64), body.csrfToken);

    // 有効な Cookie があれば再発行しない
    const again = await fetch(`${base}/records`, {
        headers: { cookie: `session=reader; dt_csrf=${TOKEN}` },
    });
    assert.equal(again.headers.get('set-cookie'), null);
    assert.equal(((await again.json()) as { csrfToken: string }).csrfToken, TOKEN);
});

test('POST requires same origin, CSRF and write access', async () => {
    reset();
    assert.equal(
        (await write('POST', '/records', 'alice', input, { origin: 'https://evil.example' }))
            .status,
        403,
    );
    assert.equal(
        (await write('POST', '/records', 'alice', input, { csrf: 'b'.repeat(64) })).status,
        403,
    );
    assert.equal((await write('POST', '/records', 'reader', { ...input, ownerId: 3 })).status, 403);
    assert.equal(store.list().length, 2);
});

test('POST validates input and owner', async () => {
    reset();
    const bad = await write('POST', '/records', 'alice', {
        ...input,
        payments: [{ payDate: '06-30', perShareText: '1.234' }],
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(await errorOf(bad), {
        error: 'Enter the dividend per share as 0 or more, with up to 2 decimal places.',
        code: 'per_share_invalid',
        params: { decimals: 2 },
    });
    const dup = await write('POST', '/records', 'alice', {
        ...input,
        payments: [input.payments[1], input.payments[1]],
    });
    assert.deepEqual(await errorOf(dup), {
        error: 'The same pay date appears more than once.',
        code: 'pay_date_duplicate',
    });
    const none = await write('POST', '/records', 'alice', { ...input, payments: [] });
    assert.equal((await errorOf(none)).code, 'payments_required');
    const tooMany = await write('POST', '/records', 'alice', {
        ...input,
        payments: Array.from({ length: 25 }, (_, i) => ({
            payDate: `01-${String(i + 1).padStart(2, '0')}`,
            perShareText: '1',
        })),
    });
    assert.deepEqual(await errorOf(tooMany), {
        error: 'You can add up to 24 pay dates.',
        code: 'payments_too_many',
        params: { max: 24 },
    });
    for (const payments of [undefined, 'x', [null], [{ payDate: '06-30' }]]) {
        const res = await write('POST', '/records', 'alice', { ...input, payments });
        assert.equal(res.status, 400, JSON.stringify(payments));
        assert.deepEqual(await errorOf(res), {
            error: 'The data format is invalid.',
            code: 'bad_request',
        });
    }
    assert.equal(
        (await write('POST', '/records', 'alice', { ...input, ownerId: '2' })).status,
        400,
    );
    const stranger = await write('POST', '/records', 'alice', { ...input, ownerId: 99 });
    assert.equal(stranger.status, 400);
    assert.equal((await errorOf(stranger)).code, 'unknown_owner');
    const other = await write('POST', '/records', 'alice', { ...input, ownerId: 1 });
    assert.equal(other.status, 403);
    assert.equal((await errorOf(other)).code, 'not_owner_add');
    const res = await fetch(`${base}/records`, {
        method: 'POST',
        headers: {
            cookie: `session=alice; dt_csrf=${TOKEN}`,
            origin: ORIGIN,
            'x-dt-csrf': TOKEN,
            'content-type': 'text/plain',
        },
        body: JSON.stringify(input),
    });
    assert.equal(res.status, 415);
    assert.equal((await errorOf(res)).code, 'unsupported_media_type');
    assert.equal(store.list().length, 2);
});

test('POST stores a record with a server-computed amount', async () => {
    reset();
    const res = await write('POST', '/records', 'alice', input);
    assert.equal(res.status, 201);
    const { data } = (await res.json()) as { data: DividendRecord };
    assert.equal(data.ownerId, 2);
    assert.equal(data.ticker, '8306');
    assert.equal(data.name, '三菱UFJ');
    assert.equal(data.shares, 3);
    // 日付順に並べ、各回の受取額は 1 円未満切り捨て（3 × 37.5 = 112.5 → 112）
    assert.deepEqual(data.payments, [
        { payDate: '06-30', perShareCents: 3750, amount: 112 },
        { payDate: '12-01', perShareCents: 4000, amount: 120 },
    ]);
    assert.equal(data.createdBy, 2);
    assert.equal(data.updatedAt, data.createdAt);
    assert.deepEqual(store.get(data.id), data);
    assert.equal(store.list().length, 3);

    // 管理者は他人の分を追加できる
    const byAdmin = await write('POST', '/records', 'admin', { ...input, ownerId: 3 });
    assert.equal(byAdmin.status, 201);
    const added = ((await byAdmin.json()) as { data: DividendRecord }).data;
    assert.equal(added.ownerId, 3);
    assert.equal(added.createdBy, 1);
});

test('PUT edits a record, keeping id and creation info', async () => {
    reset();
    const edit = {
        ...input,
        sharesText: '200',
        payments: [{ payDate: '09-30', perShareText: '50' }],
    };
    assert.equal((await write('PUT', '/records/r-admin', 'alice', edit)).status, 403);
    assert.equal(
        (await write('PUT', '/records/r-alice', 'alice', edit, { csrf: 'b'.repeat(64) })).status,
        403,
    );
    assert.equal((await write('PUT', '/records/r-alice', 'reader', edit)).status, 403);
    const missing = await write('PUT', '/records/missing', 'alice', edit);
    assert.equal(missing.status, 404);
    assert.equal((await errorOf(missing)).code, 'record_not_found');
    const othersRecord = await write('PUT', '/records/r-admin', 'alice', edit);
    assert.equal((await errorOf(othersRecord)).code, 'not_owner_edit');
    // 一般ユーザーは保有者を他人に付け替えられない
    const reassign = await write('PUT', '/records/r-alice', 'alice', { ...edit, ownerId: 1 });
    assert.equal(reassign.status, 403);
    assert.equal((await errorOf(reassign)).code, 'not_owner_add');
    const invalid = await write('PUT', '/records/r-alice', 'alice', { ...edit, sharesText: '0' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(store.get('r-alice'), existing('r-alice', 2));

    const res = await write('PUT', '/records/r-alice', 'alice', edit);
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as { data: DividendRecord };
    assert.equal(data.id, 'r-alice');
    assert.equal(data.ticker, '8306');
    assert.equal(data.shares, 200);
    assert.deepEqual(data.payments, [{ payDate: '09-30', perShareCents: 5000, amount: 10000 }]);
    assert.equal(data.createdBy, 2);
    assert.equal(data.createdAt, '2025-04-01T00:00:00.000Z');
    assert.notEqual(data.updatedAt, data.createdAt);
    assert.deepEqual(store.get('r-alice'), data);
    assert.equal(store.list().length, 2);

    // 管理者は他人の記録を編集でき、保有者も変えられる
    const byAdmin = await write('PUT', '/records/r-alice', 'admin', { ...edit, ownerId: 3 });
    assert.equal(byAdmin.status, 200);
    assert.equal(((await byAdmin.json()) as { data: DividendRecord }).data.ownerId, 3);
});

test('POST / PUT store the currency and compute amounts in its unit', async () => {
    reset();
    // 省略時は JPY（v0.4 の画面からの送信）
    const omitted = await write('POST', '/records', 'alice', input);
    assert.equal(omitted.status, 201);
    assert.equal(((await omitted.json()) as { data: DividendRecord }).data.currency, 'JPY');

    const usd = {
        ...input,
        currency: 'USD',
        sharesText: '3',
        payments: [{ payDate: '02-13', perShareText: '0.2475' }],
    };
    const res = await write('POST', '/records', 'alice', usd);
    assert.equal(res.status, 201);
    const { data } = (await res.json()) as { data: DividendRecord };
    assert.equal(data.currency, 'USD');
    // USD 0.2475 × 3 = USD 0.7425 → 74 セント
    assert.deepEqual(data.payments, [{ payDate: '02-13', perShareCents: 2475, amount: 74 }]);
    assert.deepEqual(store.get(data.id), data);

    const notString = await write('POST', '/records', 'alice', { ...usd, currency: 1 });
    assert.equal(notString.status, 400);
    assert.equal(((await notString.json()) as { code: string }).code, 'bad_request');
    const unknown = await write('POST', '/records', 'alice', { ...usd, currency: 'XYZ' });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await errorOf(unknown), {
        error: 'Choose a currency.',
        code: 'currency_required',
    });
    // JPY では小数第3位以下を受け付けない
    const tooPrecise = await write('POST', '/records', 'alice', { ...usd, currency: 'JPY' });
    assert.equal(tooPrecise.status, 400);

    // 通貨を変えると、新しい通貨の単位で計算し直す
    const edit = {
        ...input,
        currency: 'EUR',
        sharesText: '100',
        payments: [{ payDate: '03-31', perShareText: '0.45' }],
    };
    const changed = await write('PUT', '/records/r-alice', 'alice', edit);
    assert.equal(changed.status, 200);
    const updated = ((await changed.json()) as { data: DividendRecord }).data;
    assert.equal(updated.currency, 'EUR');
    assert.deepEqual(updated.payments, [{ payDate: '03-31', perShareCents: 4500, amount: 4500 }]);
});

test('DELETE enforces ownership unless admin', async () => {
    reset();
    const others = await write('DELETE', '/records/r-admin', 'alice');
    assert.equal(others.status, 403);
    assert.equal((await errorOf(others)).code, 'not_owner_delete');
    assert.equal((await write('DELETE', '/records/missing', 'alice')).status, 404);
    assert.equal((await write('DELETE', '/records/r-alice', 'reader')).status, 403);
    const own = await write('DELETE', '/records/r-alice', 'alice');
    assert.equal(own.status, 200);
    assert.deepEqual(await own.json(), { data: { id: 'r-alice', deleted: true } });
    reset();
    assert.equal((await write('DELETE', '/records/r-alice', 'admin')).status, 200);
    assert.deepEqual(
        store.list().map((r) => r.id),
        ['r-admin'],
    );
});

test('PUT /yearly-totals/<year> registers the total computed from stored records', async () => {
    reset();
    assert.equal(
        (
            await write('PUT', '/yearly-totals/2026', 'alice', undefined, {
                origin: 'https://evil.example',
            })
        ).status,
        403,
    );
    assert.equal(
        (await write('PUT', '/yearly-totals/2026', 'alice', undefined, { csrf: 'b'.repeat(64) }))
            .status,
        403,
    );
    assert.equal((await write('PUT', '/yearly-totals/2026', 'reader')).status, 403);
    for (const bad of ['1999', '2101', 'abc', '26']) {
        const res = await write('PUT', `/yearly-totals/${bad}`, 'alice');
        assert.equal(res.status, 400, bad);
        assert.deepEqual(await errorOf(res), {
            error: 'Enter a year from 2000 to 2100.',
            code: 'invalid_year',
            params: { min: 2000, max: 2100 },
        });
    }
    assert.deepEqual(store.listYearlyTotals(), []);

    // 管理者でなくても登録でき、金額はサーバーの記録から計算する（本文は使わない）
    const res = await write('PUT', '/yearly-totals/2026', 'alice', { total: 999999 });
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as { data: YearlyTotal };
    assert.equal(data.year, 2026);
    assert.deepEqual(data.totals, [
        {
            currency: 'JPY',
            total: 9000,
            owners: [
                { ownerId: 1, total: 4500 },
                { ownerId: 2, total: 4500 },
            ],
        },
    ]);
    assert.equal(data.registeredBy, 2);
    assert.deepEqual(store.listYearlyTotals(), [data]);

    // 同じ年は置き換える。年の昇順で返す
    await store.remove('r-admin');
    const again = await write('PUT', '/yearly-totals/2026', 'admin');
    const replaced = ((await again.json()) as { data: YearlyTotal }).data;
    assert.deepEqual(
        replaced.totals.map((t) => [t.currency, t.total]),
        [['JPY', 4500]],
    );
    assert.equal(replaced.registeredBy, 1);
    // 通貨ごとに分けて登録する
    await store.add({
        ...existing('r-usd', 2),
        currency: 'USD',
        payments: [{ payDate: '02-13', perShareCents: 2600, amount: 2600 }],
    });
    await write('PUT', '/yearly-totals/2020', 'admin');
    assert.deepEqual(
        store.listYearlyTotals().map((t) => [t.year, t.totals.map((c) => [c.currency, c.total])]),
        [
            [
                2020,
                [
                    ['JPY', 4500],
                    ['USD', 2600],
                ],
            ],
            [2026, [['JPY', 4500]]],
        ],
    );
    const list = await fetch(`${base}/records`, { headers: { cookie: 'session=reader' } });
    const body = (await list.json()) as { yearlyTotals: YearlyTotal[] };
    assert.deepEqual(
        body.yearlyTotals.map((t) => t.year),
        [2020, 2026],
    );

    const get = await fetch(`${base}/yearly-totals/2026`, { headers: { cookie: 'session=alice' } });
    assert.equal(get.status, 405);
});

test('unknown paths and methods', async () => {
    reset();
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const put = await fetch(`${base}/records`, {
        method: 'PUT',
        headers: { cookie: 'session=alice' },
    });
    assert.equal(put.status, 405);
    const post = await fetch(`${base}/records/r-alice`, {
        method: 'POST',
        headers: { cookie: 'session=alice' },
    });
    assert.equal(post.status, 405);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
});

test('parseMe reads id, role and module permission', () => {
    assert.deepEqual(
        parseMe({
            user: { id: 5, role: 'admin' },
            permissions: { modules: { 'ext:dividend-tracker': 'read' } },
        }),
        { id: 5, isAdmin: true, access: 'read' },
    );
    assert.deepEqual(parseMe({ user: { id: 6, role: 'member' } }), {
        id: 6,
        isAdmin: false,
        access: 'write',
    });
    assert.equal(parseMe({ user: { id: '6' } }), null);
    assert.equal(parseMe(null), null);
});

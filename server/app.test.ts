import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler, PREFIX } from './app.ts';
import { memoryStore, type Store } from './store.ts';
import type { Me } from './yuvomi.ts';
import { parseMe } from './yuvomi.ts';
import type { DividendRecord } from '../src/logic.ts';

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
let server: Server;
let base = '';

function existing(id: string, ownerId: number): DividendRecord {
    return {
        id,
        ownerId,
        ticker: '7203',
        name: 'トヨタ',
        shares: 100,
        payments: [{ payDate: '2025-03-31', perShareCents: 4500, amount: 4500 }],
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
        { payDate: '2025-12-01', perShareText: '40', amount: 999999 }, // amount は無視されるべき
        { payDate: '2025-06-30', perShareText: '37.5' },
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
        me: unknown;
        csrfToken: string;
    };
    assert.equal(body.data.length, 2);
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
        payments: [{ payDate: '2025-06-30', perShareText: '1.234' }],
    });
    assert.equal(bad.status, 400);
    assert.equal(
        ((await bad.json()) as { error: string }).error,
        '1株当たり配当は0以上、小数第2位までで入力してください',
    );
    const dup = await write('POST', '/records', 'alice', {
        ...input,
        payments: [input.payments[1], input.payments[1]],
    });
    assert.equal(((await dup.json()) as { error: string }).error, '同じ受取日が重複しています');
    const none = await write('POST', '/records', 'alice', { ...input, payments: [] });
    assert.equal(
        ((await none.json()) as { error: string }).error,
        '受取日を1つ以上入力してください',
    );
    for (const payments of [undefined, 'x', [null], [{ payDate: '2025-06-30' }]]) {
        const res = await write('POST', '/records', 'alice', { ...input, payments });
        assert.equal(res.status, 400, JSON.stringify(payments));
        assert.equal(
            ((await res.json()) as { error: string }).error,
            'データの形式が正しくありません',
        );
    }
    assert.equal(
        (await write('POST', '/records', 'alice', { ...input, ownerId: '2' })).status,
        400,
    );
    assert.equal((await write('POST', '/records', 'alice', { ...input, ownerId: 99 })).status, 400);
    assert.equal((await write('POST', '/records', 'alice', { ...input, ownerId: 1 })).status, 403);
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
        { payDate: '2025-06-30', perShareCents: 3750, amount: 112 },
        { payDate: '2025-12-01', perShareCents: 4000, amount: 120 },
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
        payments: [{ payDate: '2025-09-30', perShareText: '50' }],
    };
    assert.equal((await write('PUT', '/records/r-admin', 'alice', edit)).status, 403);
    assert.equal(
        (await write('PUT', '/records/r-alice', 'alice', edit, { csrf: 'b'.repeat(64) })).status,
        403,
    );
    assert.equal((await write('PUT', '/records/r-alice', 'reader', edit)).status, 403);
    assert.equal((await write('PUT', '/records/missing', 'alice', edit)).status, 404);
    // 一般ユーザーは保有者を他人に付け替えられない
    const reassign = await write('PUT', '/records/r-alice', 'alice', { ...edit, ownerId: 1 });
    assert.equal(reassign.status, 403);
    const invalid = await write('PUT', '/records/r-alice', 'alice', { ...edit, sharesText: '0' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(store.get('r-alice'), existing('r-alice', 2));

    const res = await write('PUT', '/records/r-alice', 'alice', edit);
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as { data: DividendRecord };
    assert.equal(data.id, 'r-alice');
    assert.equal(data.ticker, '8306');
    assert.equal(data.shares, 200);
    assert.deepEqual(data.payments, [
        { payDate: '2025-09-30', perShareCents: 5000, amount: 10000 },
    ]);
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

test('DELETE enforces ownership unless admin', async () => {
    reset();
    assert.equal((await write('DELETE', '/records/r-admin', 'alice')).status, 403);
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

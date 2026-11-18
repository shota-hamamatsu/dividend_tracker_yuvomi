import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
    type DividendRecord,
    type RecordInput,
    calcAmount,
    parsePerShare,
    parseShares,
    validateInput,
} from '../src/logic.ts';
import type { Store } from './store.ts';
import { MODULE_ID, type Me } from './yuvomi.ts';

export const PREFIX = `/api/extensions/${MODULE_ID}`;
const CSRF_COOKIE = 'dt_csrf';
const CSRF_HEADER = 'x-dt-csrf';
const MAX_BODY = 16 * 1024;

export interface Deps {
    getMe(cookie: string): Promise<Me | null>;
    getMemberIds(cookie: string): Promise<Set<number> | null>;
    store: Store;
    publicOrigin: string;
}

class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function send(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): void {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...headers,
    });
    res.end(JSON.stringify(body));
}

function parseCookies(header: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    return map;
}

function sameToken(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
    const type = req.headers['content-type'] ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'unsupported_media_type', 'JSON で送信してください');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'データが大きすぎます');
        chunks.push(chunk as Buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new HttpError(400, 'bad_json', 'データの形式が正しくありません');
    }
}

function toInput(body: unknown): RecordInput {
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { ownerId, ticker, name, payDate, sharesText, perShareText } = b;
    if (
        typeof ownerId !== 'number' ||
        typeof ticker !== 'string' ||
        typeof name !== 'string' ||
        typeof payDate !== 'string' ||
        typeof sharesText !== 'string' ||
        typeof perShareText !== 'string'
    ) {
        throw new HttpError(400, 'bad_request', 'データの形式が正しくありません');
    }
    return { ownerId, ticker, name, payDate, sharesText, perShareText };
}

export function createHandler(deps: Deps) {
    const secureCookie = deps.publicOrigin.startsWith('https://');

    const authenticate = async (req: IncomingMessage): Promise<{ me: Me; cookie: string }> => {
        const cookie = req.headers.cookie;
        if (!cookie) throw new HttpError(401, 'unauthenticated', 'ログインしてください');
        let me: Me | null;
        try {
            me = await deps.getMe(cookie);
        } catch {
            throw new HttpError(502, 'yuvomi_unreachable', 'yuvomi に接続できませんでした');
        }
        if (!me) throw new HttpError(401, 'unauthenticated', 'ログインしてください');
        if (me.access === 'none') {
            throw new HttpError(403, 'forbidden', 'このモジュールを使う権限がありません');
        }
        return { me, cookie };
    };

    const checkWrite = (req: IncomingMessage, me: Me, cookie: string): void => {
        if (req.headers.origin !== deps.publicOrigin) {
            throw new HttpError(403, 'bad_origin', '不正なリクエストです');
        }
        const fromCookie = parseCookies(cookie).get(CSRF_COOKIE);
        const fromHeader = req.headers[CSRF_HEADER];
        if (!fromCookie || typeof fromHeader !== 'string' || !sameToken(fromCookie, fromHeader)) {
            throw new HttpError(403, 'csrf', '画面を再読み込みしてから、もう一度お試しください');
        }
        if (me.access !== 'write') {
            throw new HttpError(403, 'read_only', '閲覧のみの権限です');
        }
    };

    const listRecords = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        let token = parseCookies(cookie).get(CSRF_COOKIE) ?? '';
        const headers: Record<string, string> = {};
        if (!/^[0-9a-f]{64}$/.test(token)) {
            token = randomBytes(32).toString('hex');
            headers['set-cookie'] =
                `${CSRF_COOKIE}=${token}; Path=${PREFIX}; HttpOnly; SameSite=Strict` +
                (secureCookie ? '; Secure' : '');
        }
        send(
            res,
            200,
            {
                data: deps.store.list(),
                me: { id: me.id, isAdmin: me.isAdmin, canWrite: me.access === 'write' },
                csrfToken: token,
            },
            headers,
        );
    };

    const addRecord = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const input = toInput(await readJson(req));
        const error = validateInput(input);
        if (error !== null) throw new HttpError(400, 'invalid', error);

        let members: Set<number> | null;
        try {
            members = await deps.getMemberIds(cookie);
        } catch {
            members = null;
        }
        if (!members) {
            throw new HttpError(502, 'yuvomi_unreachable', 'yuvomi に接続できませんでした');
        }
        if (!members.has(input.ownerId)) {
            throw new HttpError(400, 'unknown_owner', '保有者が家族にいません');
        }
        if (!me.isAdmin && input.ownerId !== me.id) {
            throw new HttpError(403, 'not_owner', '自分以外の記録は管理者だけが追加できます');
        }

        // validateInput を通っているので null にはならない
        const shares = parseShares(input.sharesText) as number;
        const perShareCents = parsePerShare(input.perShareText) as number;
        const record: DividendRecord = {
            id: randomUUID(),
            ownerId: input.ownerId,
            ticker: input.ticker.trim(),
            name: input.name.trim(),
            payDate: input.payDate,
            shares,
            perShareCents,
            amount: calcAmount(shares, perShareCents),
            createdBy: me.id,
            createdAt: new Date().toISOString(),
        };
        try {
            await deps.store.add(record);
        } catch {
            throw new HttpError(500, 'save_failed', '保存できませんでした');
        }
        send(res, 201, { data: record });
    };

    const deleteRecord = async (
        req: IncomingMessage,
        res: ServerResponse,
        id: string,
    ): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const record = deps.store.get(id);
        if (!record) throw new HttpError(404, 'not_found', '記録が見つかりません');
        if (!me.isAdmin && record.ownerId !== me.id) {
            throw new HttpError(403, 'not_owner', '自分以外の記録は管理者だけが削除できます');
        }
        try {
            await deps.store.remove(id);
        } catch {
            throw new HttpError(500, 'save_failed', '保存できませんでした');
        }
        send(res, 200, { data: { id, deleted: true } });
    };

    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
            const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
            const method = req.method ?? 'GET';

            if (path === `${PREFIX}/health`) {
                if (method !== 'GET')
                    throw new HttpError(405, 'method', '許可されていない操作です');
                send(res, 200, { ok: true });
                return;
            }
            if (path === `${PREFIX}/records`) {
                if (method === 'GET') return await listRecords(req, res);
                if (method === 'POST') return await addRecord(req, res);
                throw new HttpError(405, 'method', '許可されていない操作です');
            }
            const match = /^\/records\/([^/]+)$/.exec(
                path.startsWith(PREFIX) ? path.slice(PREFIX.length) : '',
            );
            if (match?.[1]) {
                if (method !== 'DELETE') {
                    throw new HttpError(405, 'method', '許可されていない操作です');
                }
                return await deleteRecord(req, res, decodeURIComponent(match[1]));
            }
            throw new HttpError(404, 'not_found', '見つかりません');
        } catch (err) {
            if (err instanceof HttpError) {
                send(res, err.status, { error: err.message, code: err.code });
            } else {
                console.error(err);
                send(res, 500, { error: 'サーバーでエラーが発生しました', code: 'internal' });
            }
        }
    };
}

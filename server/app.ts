import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
    type DividendRecord,
    type PaymentInput,
    type RecordInput,
    type Currency,
    type InputErrorCode,
    MAX_PAYMENTS,
    MAX_YEAR,
    MIN_YEAR,
    buildPayments,
    buildYearlyTotal,
    parseShares,
    parseYear,
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

/** The UI translates by code. The English message is for curl and logs. */
class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly params: Record<string, number> | undefined;
    constructor(status: number, code: string, message: string, params?: Record<string, number>) {
        super(message);
        this.status = status;
        this.code = code;
        this.params = params;
    }
}

/** English text for input errors (same as errors.<code> in locales/en.json). */
const INPUT_ERROR_MESSAGES: Record<InputErrorCode, (p: Record<string, number>) => string> = {
    owner_required: () => 'Choose a holder.',
    currency_required: () => 'Choose a currency.',
    ticker_required: () => 'Enter a ticker.',
    shares_invalid: () => 'Enter the shares as a whole number of 1 or more.',
    payments_required: () => 'Add at least one pay date.',
    payments_too_many: (p) => `You can add up to ${String(p['max'])} pay dates.`,
    pay_date_invalid: () => 'Choose a valid pay date.',
    per_share_invalid: (p) =>
        `Enter the dividend per share as 0 or more, with up to ${String(p['decimals'])} decimal places.`,
    pay_date_duplicate: () => 'The same pay date appears more than once.',
};

const METHOD_NOT_ALLOWED = (): HttpError =>
    new HttpError(405, 'method', 'This operation is not allowed.');
const RECORD_NOT_FOUND = (): HttpError =>
    new HttpError(404, 'record_not_found', 'Record not found.');
const SAVE_FAILED = (): HttpError => new HttpError(500, 'save_failed', 'Could not save.');
const UNREACHABLE = (): HttpError =>
    new HttpError(502, 'yuvomi_unreachable', 'Could not connect to yuvomi.');
const BAD_REQUEST = (): HttpError =>
    new HttpError(400, 'bad_request', 'The data format is invalid.');

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
        throw new HttpError(415, 'unsupported_media_type', 'Send the data as JSON.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'The data is too large.');
        chunks.push(chunk as Buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new HttpError(400, 'bad_json', 'The data format is invalid.');
    }
}

function toPayments(value: unknown): PaymentInput[] {
    if (!Array.isArray(value)) throw BAD_REQUEST();
    // Too many payments: let validateInput report it before checking each item
    if (value.length > MAX_PAYMENTS) return value as PaymentInput[];
    return value.map((item: unknown) => {
        const p = (typeof item === 'object' && item !== null ? item : {}) as Record<
            string,
            unknown
        >;
        const { payDate, perShareText } = p;
        if (typeof payDate !== 'string' || typeof perShareText !== 'string') {
            throw BAD_REQUEST();
        }
        return { payDate, perShareText };
    });
}

function toInput(body: unknown): RecordInput {
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { ownerId, ticker, name, sharesText } = b;
    // JPY when omitted (also accepts requests from the v0.4 UI)
    const currency = b['currency'] ?? 'JPY';
    if (
        typeof ownerId !== 'number' ||
        typeof currency !== 'string' ||
        typeof ticker !== 'string' ||
        typeof name !== 'string' ||
        typeof sharesText !== 'string'
    ) {
        throw BAD_REQUEST();
    }
    return { ownerId, currency, ticker, name, sharesText, payments: toPayments(b['payments']) };
}

export function createHandler(deps: Deps) {
    const secureCookie = deps.publicOrigin.startsWith('https://');

    const authenticate = async (req: IncomingMessage): Promise<{ me: Me; cookie: string }> => {
        const cookie = req.headers.cookie;
        if (!cookie) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
        let me: Me | null;
        try {
            me = await deps.getMe(cookie);
        } catch {
            throw UNREACHABLE();
        }
        if (!me) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
        if (me.access === 'none') {
            throw new HttpError(403, 'forbidden', 'You do not have permission to use this module.');
        }
        return { me, cookie };
    };

    const checkWrite = (req: IncomingMessage, me: Me, cookie: string): void => {
        if (req.headers.origin !== deps.publicOrigin) {
            throw new HttpError(403, 'bad_origin', 'Invalid request.');
        }
        const fromCookie = parseCookies(cookie).get(CSRF_COOKIE);
        const fromHeader = req.headers[CSRF_HEADER];
        if (!fromCookie || typeof fromHeader !== 'string' || !sameToken(fromCookie, fromHeader)) {
            throw new HttpError(403, 'csrf', 'Reload the page and try again.');
        }
        if (me.access !== 'write') {
            throw new HttpError(403, 'read_only', 'You have view-only access.');
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
                yearlyTotals: deps.store.listYearlyTotals(),
                me: { id: me.id, isAdmin: me.isAdmin, canWrite: me.access === 'write' },
                csrfToken: token,
            },
            headers,
        );
    };

    /** Reads the body and returns validated input checked against the family (POST and PUT). */
    const readValidInput = async (req: IncomingMessage, cookie: string): Promise<RecordInput> => {
        const input = toInput(await readJson(req));
        const error = validateInput(input);
        if (error !== null) {
            const params = error.params ?? {};
            throw new HttpError(
                400,
                error.code,
                INPUT_ERROR_MESSAGES[error.code](params),
                error.params,
            );
        }

        let members: Set<number> | null;
        try {
            members = await deps.getMemberIds(cookie);
        } catch {
            members = null;
        }
        if (!members) {
            throw UNREACHABLE();
        }
        if (!members.has(input.ownerId)) {
            throw new HttpError(400, 'unknown_owner', 'The holder is not in your family.');
        }
        return input;
    };

    /** Builds the stored fields from input. It passed validateInput, so parsing never returns null. */
    const fields = (input: RecordInput) => {
        const shares = parseShares(input.sharesText) as number;
        const currency = input.currency as Currency;
        return {
            ownerId: input.ownerId,
            currency,
            ticker: input.ticker.trim(),
            name: input.name.trim(),
            shares,
            payments: buildPayments(shares, input.payments, currency),
        };
    };

    const addRecord = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const input = await readValidInput(req, cookie);
        if (!me.isAdmin && input.ownerId !== me.id) {
            throw new HttpError(
                403,
                'not_owner_add',
                'Only admins can add records for other people.',
            );
        }
        const now = new Date().toISOString();
        const record: DividendRecord = {
            id: randomUUID(),
            ...fields(input),
            createdBy: me.id,
            createdAt: now,
            updatedAt: now,
        };
        try {
            await deps.store.add(record);
        } catch {
            throw SAVE_FAILED();
        }
        send(res, 201, { data: record });
    };

    const updateRecord = async (
        req: IncomingMessage,
        res: ServerResponse,
        id: string,
    ): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const input = await readValidInput(req, cookie);
        const current = deps.store.get(id);
        if (!current) throw RECORD_NOT_FOUND();
        if (!me.isAdmin && current.ownerId !== me.id) {
            throw new HttpError(
                403,
                'not_owner_edit',
                "Only admins can edit other people's records.",
            );
        }
        if (!me.isAdmin && input.ownerId !== me.id) {
            throw new HttpError(
                403,
                'not_owner_add',
                'Only admins can add records for other people.',
            );
        }
        const record: DividendRecord = {
            id: current.id,
            ...fields(input),
            createdBy: current.createdBy,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
        };
        let updated: boolean;
        try {
            updated = await deps.store.update(record);
        } catch {
            throw SAVE_FAILED();
        }
        // Deleted while the body was being read
        if (!updated) throw RECORD_NOT_FOUND();
        send(res, 200, { data: record });
    };

    const deleteRecord = async (
        req: IncomingMessage,
        res: ServerResponse,
        id: string,
    ): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const record = deps.store.get(id);
        if (!record) throw RECORD_NOT_FOUND();
        if (!me.isAdmin && record.ownerId !== me.id) {
            throw new HttpError(
                403,
                'not_owner_delete',
                "Only admins can delete other people's records.",
            );
        }
        try {
            await deps.store.remove(id);
        } catch {
            throw SAVE_FAILED();
        }
        send(res, 200, { data: { id, deleted: true } });
    };

    /** Registers the year's total computed from everyone's stored records (the body is not read). */
    const registerYearlyTotal = async (
        req: IncomingMessage,
        res: ServerResponse,
        yearText: string,
    ): Promise<void> => {
        const { me, cookie } = await authenticate(req);
        checkWrite(req, me, cookie);
        const year = parseYear(yearText);
        if (year === null) {
            throw new HttpError(
                400,
                'invalid_year',
                `Enter a year from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}.`,
                { min: MIN_YEAR, max: MAX_YEAR },
            );
        }
        const total = buildYearlyTotal(deps.store.list(), year, me.id, new Date().toISOString());
        try {
            await deps.store.putYearlyTotal(total);
        } catch {
            throw SAVE_FAILED();
        }
        send(res, 200, { data: total });
    };

    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
            const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
            const method = req.method ?? 'GET';

            if (path === `${PREFIX}/health`) {
                if (method !== 'GET') throw METHOD_NOT_ALLOWED();
                send(res, 200, { ok: true });
                return;
            }
            if (path === `${PREFIX}/records`) {
                if (method === 'GET') return await listRecords(req, res);
                if (method === 'POST') return await addRecord(req, res);
                throw METHOD_NOT_ALLOWED();
            }
            const rest = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : '';
            const yearMatch = /^\/yearly-totals\/([^/]+)$/.exec(rest);
            if (yearMatch?.[1]) {
                if (method === 'PUT') {
                    return await registerYearlyTotal(req, res, decodeURIComponent(yearMatch[1]));
                }
                throw METHOD_NOT_ALLOWED();
            }
            const match = /^\/records\/([^/]+)$/.exec(rest);
            if (match?.[1]) {
                const id = decodeURIComponent(match[1]);
                if (method === 'PUT') return await updateRecord(req, res, id);
                if (method === 'DELETE') return await deleteRecord(req, res, id);
                throw METHOD_NOT_ALLOWED();
            }
            throw new HttpError(404, 'not_found', 'Not found.');
        } catch (err) {
            if (err instanceof HttpError) {
                send(res, err.status, {
                    error: err.message,
                    code: err.code,
                    ...(err.params ? { params: err.params } : {}),
                });
            } else {
                console.error(err);
                send(res, 500, { error: 'A server error occurred.', code: 'internal' });
            }
        }
    };
}

export const MODULE_ID = 'dividend-tracker';

export type Access = 'none' | 'read' | 'write';

export interface Me {
    id: number;
    isAdmin: boolean;
    access: Access;
}

/** 短期キャッシュ。件数上限を超えたら古いものから捨てる。 */
class TtlCache<T> {
    private readonly entries = new Map<string, { value: T; expires: number }>();
    private readonly ttlMs: number;
    private readonly max: number;

    constructor(ttlMs: number, max: number) {
        this.ttlMs = ttlMs;
        this.max = max;
    }

    get(key: string): T | undefined {
        const hit = this.entries.get(key);
        if (!hit) return undefined;
        if (hit.expires <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        return hit.value;
    }

    set(key: string, value: T): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
        while (this.entries.size > this.max) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }
}

function toAccess(value: unknown): Access {
    if (value === 'none') return 'none';
    if (value === 'read') return 'read';
    return 'write';
}

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function parseMe(body: unknown): Me | null {
    if (typeof body !== 'object' || body === null) return null;
    const root = body as Record<string, unknown>;
    const user = root['user'] as Record<string, unknown> | undefined;
    if (!user || !isPositiveInt(user['id'])) return null;
    const permissions = (root['permissions'] ?? user['permissions']) as
        { modules?: Record<string, unknown> } | undefined;
    return {
        id: user['id'],
        isAdmin: user['role'] === 'admin',
        access: toAccess(permissions?.modules?.[`ext:${MODULE_ID}`]),
    };
}

export function parseMemberIds(body: unknown): Set<number> | null {
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return null;
    const ids = new Set<number>();
    for (const m of data) {
        const id = (m as { id?: unknown } | null)?.id;
        if (isPositiveInt(id)) ids.add(id);
    }
    return ids;
}

/** yuvomi の /api/v1 を呼び出し者の Cookie で問い合わせる。 */
export function yuvomiClient(internalUrl: string) {
    const base = internalUrl.replace(/\/+$/, '');
    const meCache = new TtlCache<Me>(5000, 500);
    const memberCache = new TtlCache<Set<number>>(5000, 500);

    const getJson = async (path: string, cookie: string): Promise<unknown> => {
        const res = await fetch(`${base}/api/v1${path}`, {
            headers: { cookie, accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
        if (res.status !== 200) return null;
        return res.json();
    };

    return {
        async getMe(cookie: string): Promise<Me | null> {
            const cached = meCache.get(cookie);
            if (cached) return cached;
            const me = parseMe(await getJson('/auth/me', cookie));
            if (me) meCache.set(cookie, me);
            return me;
        },
        async getMemberIds(cookie: string): Promise<Set<number> | null> {
            const cached = memberCache.get(cookie);
            if (cached) return cached;
            const ids = parseMemberIds(await getJson('/family/members', cookie));
            if (ids) memberCache.set(cookie, ids);
            return ids;
        },
    };
}

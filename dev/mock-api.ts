// yuvomi の /api.js の偽物。家族一覧だけ返す。
export const MEMBERS = [
    { id: 1, display_name: '太郎' },
    { id: 2, display_name: '花子' },
    { id: 3, display_name: '次郎' },
];

export const api = {
    async get(path: string, opts?: { signal?: AbortSignal }): Promise<unknown> {
        if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (path === '/family/members') return { data: MEMBERS };
        throw new Error(`dev mock: 未対応のパス ${path}`);
    },
};

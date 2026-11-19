// Mock of yuvomi's /api.js. Returns only the family list.
export const MEMBERS = [
    { id: 1, display_name: 'Taro' },
    { id: 2, display_name: 'Hanako' },
    { id: 3, display_name: 'Jiro' },
];

export const api = {
    async get(path: string, opts?: { signal?: AbortSignal }): Promise<unknown> {
        if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (path === '/family/members') return { data: MEMBERS };
        throw new Error(`dev mock: unsupported path ${path}`);
    },
};

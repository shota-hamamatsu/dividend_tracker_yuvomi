// yuvomi が提供する /api.js（ビルド時は external）。使う部分だけ型を書く。
export declare const api: {
    get(path: string, opts?: { signal?: AbortSignal }): Promise<unknown>;
};

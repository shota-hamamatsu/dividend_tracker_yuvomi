// yuvomi が提供する /i18n.js（ビルド時は external）。使う部分だけ型を書く。
// getLocale / getFormatLocale は MODULES.md に書かれていないため、無い場合も考える。
export declare function t(key: string, params?: Record<string, string | number>): string;
export declare const getLocale: (() => string) | undefined;
export declare const getFormatLocale: (() => string) | undefined;

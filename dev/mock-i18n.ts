/// <reference types="vite/client" />
// Mock of yuvomi's /i18n.js. Looks strings up in the module's locales/*.json.
const files = import.meta.glob<Record<string, string>>(
    '../modules/dividend-tracker/locales/*.json',
    {
        eager: true,
        import: 'default',
    },
);

/** Locale code → strings (keys without the extensions.dividend-tracker. prefix). */
const BUNDLES = new Map<string, Record<string, string>>(
    Object.entries(files).map(([path, data]) => [
        path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
        data,
    ]),
);

export const LOCALES = [...BUNDLES.keys()].sort();

const PREFIX = 'extensions.dividend-tracker.';
const RTL = new Set(['ar', 'fa']);

let current = 'ja';

export function getLocale(): string {
    return current;
}

export function getFormatLocale(): string {
    return current;
}

/** Changes the locale, sets <html lang dir> like yuvomi, and fires locale-changed. */
export function setLocale(locale: string): void {
    current = BUNDLES.has(locale) ? locale : 'ja';
    document.documentElement.lang = current;
    document.documentElement.dir = RTL.has(current) ? 'rtl' : 'ltr';
    window.dispatchEvent(new CustomEvent('locale-changed', { detail: { locale: current } }));
}

function lookup(key: string): string | undefined {
    for (const locale of [current, 'en']) {
        const value = BUNDLES.get(locale)?.[key];
        if (typeof value === 'string') return value;
    }
    return undefined;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
    if (!key.startsWith(PREFIX)) return key;
    const sub = key.slice(PREFIX.length);
    let text: string | undefined;
    if (typeof params['count'] === 'number') {
        const category = new Intl.PluralRules(current).select(params['count']);
        text = lookup(`${sub}_${category}`) ?? lookup(`${sub}_other`) ?? lookup(sub);
    } else {
        text = lookup(sub);
    }
    if (text === undefined) return key;
    return text.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
    );
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../modules/dividend-tracker/locales/', import.meta.url);
const SPEC = new URL('../docs/specs/dividend-tracker-i18n.md', import.meta.url);

// The same 27 locales as yuvomi's public/locales
const LOCALES = [
    'ar', 'cs', 'de', 'el', 'en', 'es', 'fa', 'fil', 'fr', 'hi', 'hu', 'id', 'it', 'ja',
    'ko', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ru', 'sv', 'tr', 'uk', 'vi', 'zh', 'zh-Hant',
]; // prettier-ignore

const PLURAL = /_(zero|one|two|few|many|other)$/;

function load(locale: string): Record<string, unknown> {
    return JSON.parse(readFileSync(new URL(`${locale}.json`, DIR), 'utf8')) as Record<
        string,
        unknown
    >;
}

const placeholders = (text: string): string[] =>
    [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ''))].sort();

const en = load('en');
// Plural keys are only those with <base>_other in en (errors.payments_too_many is not plural)
const pluralBases = new Set(
    Object.keys(en)
        .filter((key) => key.endsWith('_other'))
        .map((key) => key.slice(0, -'_other'.length)),
);

/** The key without its plural suffix. */
const baseKey = (key: string): string => {
    const base = key.replace(PLURAL, '');
    return base !== key && pluralBases.has(base) ? base : key;
};
const isPlural = (key: string): boolean => baseKey(key) !== key;

/** en key (base for plurals) → placeholder names. Plurals are compared with their _other text. */
const enPlaceholders = new Map<string, string[]>();
for (const [key, value] of Object.entries(en)) {
    if (isPlural(key) && !key.endsWith('_other')) continue;
    enPlaceholders.set(baseKey(key), placeholders(String(value)));
}

test('all 27 locale files exist and nothing else', () => {
    const files = readdirSync(DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
    assert.deepEqual(files, [...LOCALES].sort());
});

for (const locale of LOCALES) {
    test(`${locale}.json has the same keys and placeholders as en.json`, () => {
        const data = load(locale);
        const bases = new Set(Object.keys(data).map(baseKey));
        assert.deepEqual([...bases].sort(), [...enPlaceholders.keys()].sort());
        for (const [key, value] of Object.entries(data)) {
            assert.equal(typeof value, 'string', key);
            assert.notEqual(String(value).trim(), '', key);
            assert.deepEqual(placeholders(String(value)), enPlaceholders.get(baseKey(key)), key);
            if (isPlural(key)) assert.ok(`${baseKey(key)}_other` in data, `${key}: _other`);
        }
    });
}

test('ja.json and en.json match the table in the spec', () => {
    // Read only the string table: the one whose header ends with "| ja | en |"
    const lines = readFileSync(SPEC, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const header = lines.findIndex((line) => line.endsWith('| ja | en |'));
    assert.ok(header >= 0, 'string table in the spec');
    const tableEnd = lines.findIndex((line, i) => i > header && !line.startsWith('|'));
    const rows = lines
        .slice(header + 2, tableEnd)
        .map((line) =>
            line
                .slice(1, -1)
                .split(' | ')
                .map((cell) => cell.trim()),
        )
        .filter((cells) => cells.length === 3);
    const cell = (text: string): string | undefined => {
        // An em dash means the locale has no such key
        if (text === '—') return undefined;
        // Values wrapped in backticks show leading or trailing spaces, such as `, `
        return /^`.*`$/.test(text) ? text.slice(1, -1) : text;
    };
    const expected: Record<'ja' | 'en', Record<string, string>> = { ja: {}, en: {} };
    for (const [keyCell = '', ja = '', enText = ''] of rows) {
        const key = keyCell.slice(1, -1);
        const jaValue = cell(ja);
        const enValue = cell(enText);
        if (jaValue !== undefined) expected.ja[key] = jaValue;
        if (enValue !== undefined) expected.en[key] = enValue;
    }
    assert.ok(Object.keys(expected.en).length > 80);
    assert.deepEqual(load('ja'), expected.ja);
    assert.deepEqual(load('en'), expected.en);
});

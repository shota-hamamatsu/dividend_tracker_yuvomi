import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isValidRecord,
    parseRecords,
    validateInput,
    yearlyTotals,
    sortByPayDateDesc,
    formatYen,
    newId,
    type DividendRecord,
} from './logic.ts';

const rec = (id: string, payDate: string, amount: number): DividendRecord => ({
    id,
    ticker: '8306',
    name: '',
    payDate,
    amount,
});

test('formatYen: 3桁区切り', () => {
    assert.equal(formatYen(0), '0円');
    assert.equal(formatYen(999), '999円');
    assert.equal(formatYen(1000), '1,000円');
    assert.equal(formatYen(1234567), '1,234,567円');
});

test('yearlyTotals: 年ごとに合計し新しい年が先', () => {
    const totals = yearlyTotals([
        rec('a', '2024-03-01', 100),
        rec('b', '2025-06-15', 250),
        rec('c', '2024-12-31', 50),
        rec('d', '2025-01-01', 1),
    ]);
    assert.deepEqual(totals, [
        { year: '2025', total: 251 },
        { year: '2024', total: 150 },
    ]);
    assert.deepEqual(yearlyTotals([]), []);
});

test('sortByPayDateDesc: 新しい順・同日は元の順・元配列は不変', () => {
    const input = [rec('a', '2024-01-01', 1), rec('b', '2025-01-01', 2), rec('c', '2025-01-01', 3)];
    const snapshot = input.map((r) => r.id);
    const sorted = sortByPayDateDesc(input);
    assert.deepEqual(
        sorted.map((r) => r.id),
        ['b', 'c', 'a'],
    );
    assert.deepEqual(
        input.map((r) => r.id),
        snapshot,
    );
});

test('validateInput', () => {
    const ok = { ticker: '8306', payDate: '2025-06-15', amountText: '1200' };
    assert.equal(validateInput(ok), null);
    assert.equal(validateInput({ ...ok, amountText: '0' }), null);
    assert.equal(validateInput({ ...ok, ticker: '  ' }), '銘柄コードを入力してください');
    assert.equal(validateInput({ ...ok, payDate: '' }), '受取日を入力してください');
    for (const bad of ['', '-1', '1.5', 'abc', '1e3', ' ']) {
        assert.equal(
            validateInput({ ...ok, amountText: bad }),
            '受取額は0以上の整数で入力してください',
            bad,
        );
    }
});

test('isValidRecord / parseRecords', () => {
    assert.equal(isValidRecord(rec('a', '2025-01-01', 10)), true);
    assert.equal(isValidRecord({ ...rec('a', '2025-01-01', 10), amount: -1 }), false);
    assert.equal(isValidRecord({ ...rec('a', '2025-01-01', 10), amount: 1.5 }), false);
    assert.equal(isValidRecord({ ...rec('a', '2025-01-01', 10), amount: Infinity }), false);
    assert.equal(isValidRecord({ ...rec('a', '2025-01-01', 10), ticker: '' }), false);
    assert.equal(isValidRecord({ ...rec('a', '2025-1-1', 10) }), false);
    assert.equal(isValidRecord(null), false);

    assert.deepEqual(parseRecords(null), []);
    assert.deepEqual(parseRecords('not json'), []);
    assert.deepEqual(parseRecords('{"a":1}'), []);
    const good = rec('a', '2025-01-01', 10);
    assert.deepEqual(parseRecords(JSON.stringify([good, { bad: true }, 5])), [good]);
});

test('newId: 重複しない文字列', () => {
    const a = newId();
    const b = newId();
    assert.equal(typeof a, 'string');
    assert.ok(a.length > 0);
    assert.notEqual(a, b);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    type DividendRecord,
    calcAmount,
    filterByOwner,
    formatPerShare,
    formatYen,
    isValidDate,
    isValidRecord,
    parsePerShare,
    parseRecords,
    parseShares,
    sortByPayDateDesc,
    validateInput,
    yearlyTotals,
} from './logic.ts';

function rec(over: Partial<DividendRecord>): DividendRecord {
    return {
        id: 'x',
        ownerId: 1,
        ticker: '7203',
        name: '',
        payDate: '2025-01-01',
        shares: 100,
        perShareCents: 1000,
        amount: 1000,
        createdBy: 1,
        createdAt: '2025-01-01T00:00:00.000Z',
        ...over,
    };
}

test('formatYen groups by three digits', () => {
    assert.equal(formatYen(0), '0円');
    assert.equal(formatYen(999), '999円');
    assert.equal(formatYen(1000), '1,000円');
    assert.equal(formatYen(1234567), '1,234,567円');
});

test('parseShares', () => {
    assert.equal(parseShares('1'), 1);
    assert.equal(parseShares('100'), 100);
    assert.equal(parseShares('10000000'), 10_000_000);
    for (const bad of ['', '0', '01', '-1', '1.5', '1e3', ' 1', 'abc', '10000001']) {
        assert.equal(parseShares(bad), null, bad);
    }
});

test('parsePerShare converts to hundredths without floats', () => {
    assert.equal(parsePerShare('37.5'), 3750);
    assert.equal(parsePerShare('0.05'), 5);
    assert.equal(parsePerShare('12'), 1200);
    assert.equal(parsePerShare('0'), 0);
    assert.equal(parsePerShare('0.29'), 29); // 0.29*100 は浮動小数点だと 28.999...
    assert.equal(parsePerShare('100000'), 10_000_000);
    for (const bad of ['', '1.234', '-1', '1e3', ' 1', '.5', '1.', 'abc', '100000.01']) {
        assert.equal(parsePerShare(bad), null, bad);
    }
});

test('calcAmount floors below one yen', () => {
    assert.equal(calcAmount(3, 3750), 112);
    assert.equal(calcAmount(100, 3750), 3750);
    assert.equal(calcAmount(1, 5), 0);
    assert.equal(calcAmount(10_000_000, 10_000_000), 1_000_000_000_000);
});

test('isValidDate', () => {
    assert.equal(isValidDate('2024-02-29'), true);
    assert.equal(isValidDate('2025-12-31'), true);
    for (const bad of ['2025-02-29', '2025-02-30', '2025-13-01', '2025-00-10', '2025-1-1', '']) {
        assert.equal(isValidDate(bad), false, bad);
    }
});

test('validateInput', () => {
    const ok = {
        ownerId: 1,
        ticker: '7203',
        name: '',
        payDate: '2025-03-31',
        sharesText: '100',
        perShareText: '37.5',
    };
    assert.equal(validateInput(ok), null);
    assert.equal(validateInput({ ...ok, ownerId: 0 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ownerId: 1.5 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ticker: '  ' }), '銘柄コードを入力してください');
    assert.equal(validateInput({ ...ok, payDate: '2025-02-30' }), '受取日を入力してください');
    assert.equal(
        validateInput({ ...ok, sharesText: '0' }),
        '保有株数は1以上の整数で入力してください',
    );
    assert.equal(
        validateInput({ ...ok, perShareText: '1.234' }),
        '1株当たり配当は0以上、小数第2位までで入力してください',
    );
});

test('isValidRecord / parseRecords', () => {
    assert.equal(isValidRecord(rec({})), true);
    assert.equal(isValidRecord(rec({ amount: 999 })), false);
    assert.equal(isValidRecord(rec({ ownerId: 0 })), false);
    assert.equal(isValidRecord(rec({ ticker: '' })), false);
    assert.equal(isValidRecord(rec({ shares: 0, amount: 0 })), false);
    assert.equal(isValidRecord(rec({ payDate: '2025-02-30' })), false);
    assert.equal(isValidRecord(null), false);
    assert.equal(isValidRecord('x'), false);

    assert.deepEqual(parseRecords(null), []);
    assert.deepEqual(parseRecords('{'), []);
    assert.deepEqual(parseRecords('{}'), []);
    const good = rec({ id: 'a' });
    assert.deepEqual(parseRecords(JSON.stringify([good, { id: 'b' }])), [good]);
});

test('filterByOwner', () => {
    const list = [rec({ id: 'a', ownerId: 1 }), rec({ id: 'b', ownerId: 2 })];
    const all = filterByOwner(list, null);
    assert.deepEqual(all, list);
    assert.notEqual(all, list);
    assert.deepEqual(
        filterByOwner(list, 2).map((r) => r.id),
        ['b'],
    );
});

test('yearlyTotals and sortByPayDateDesc', () => {
    const list = [
        rec({ id: 'a', payDate: '2024-06-01', amount: 1000 }),
        rec({ id: 'b', payDate: '2025-03-01', amount: 2000, shares: 200 }),
        rec({ id: 'c', payDate: '2025-03-01', amount: 500, shares: 50 }),
    ];
    assert.deepEqual(yearlyTotals(list), [
        { year: '2025', total: 2500 },
        { year: '2024', total: 1000 },
    ]);
    assert.deepEqual(yearlyTotals([]), []);
    assert.deepEqual(
        sortByPayDateDesc(list).map((r) => r.id),
        ['b', 'c', 'a'],
    );
    assert.deepEqual(
        list.map((r) => r.id),
        ['a', 'b', 'c'],
    );
});

test('formatPerShare', () => {
    assert.equal(formatPerShare(3750), '37.5円');
    assert.equal(formatPerShare(5), '0.05円');
    assert.equal(formatPerShare(120000), '1,200円');
    assert.equal(formatPerShare(0), '0円');
    assert.equal(formatPerShare(123456), '1,234.56円');
});

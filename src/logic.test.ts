import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    type DividendRecord,
    MAX_PAYMENTS,
    buildPayments,
    calcAmount,
    filterByOwner,
    formatPerShare,
    formatYen,
    isValidDate,
    isValidRecord,
    migrateLegacyRecord,
    monthlyTotals,
    parsePerShare,
    parseRecords,
    parseShares,
    recordTotal,
    sortForList,
    validateInput,
    yearlyTotals,
} from './logic.ts';

function rec(over: Partial<DividendRecord>): DividendRecord {
    return {
        id: 'x',
        ownerId: 1,
        ticker: '7203',
        name: '',
        shares: 100,
        payments: [{ payDate: '2025-01-01', perShareCents: 1000, amount: 1000 }],
        createdBy: 1,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        ...over,
    };
}

function pay(payDate: string, perShareCents = 1000, amount = 1000) {
    return { payDate, perShareCents, amount };
}

/** 2025-01-01 から n 日分の日付 */
function days(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
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
    const p = (payDate: string, perShareText = '10') => ({ payDate, perShareText });
    const ok = {
        ownerId: 1,
        ticker: '7203',
        name: '',
        sharesText: '100',
        payments: [p('2025-03-31', '37.5'), p('2025-09-30', '40')],
    };
    const perShareError = '1株当たり配当は0以上、小数第2位までで入力してください';
    assert.equal(validateInput(ok), null);
    assert.equal(validateInput({ ...ok, ownerId: 0 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ownerId: 1.5 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ticker: '  ' }), '銘柄コードを入力してください');
    assert.equal(
        validateInput({ ...ok, sharesText: '0' }),
        '保有株数は1以上の整数で入力してください',
    );
    assert.equal(validateInput({ ...ok, payments: [] }), '受取日を1つ以上入力してください');
    const all = days(MAX_PAYMENTS + 1).map((d) => p(d));
    assert.equal(validateInput({ ...ok, payments: all.slice(0, MAX_PAYMENTS) }), null);
    assert.equal(validateInput({ ...ok, payments: all }), '受取日は24件までです');
    assert.equal(
        validateInput({ ...ok, payments: [p('2025-03-31'), p('2025-02-30')] }),
        '受取日を入力してください',
    );
    assert.equal(validateInput({ ...ok, payments: [p('')] }), '受取日を入力してください');
    assert.equal(validateInput({ ...ok, payments: [p('2025-03-31', '1.234')] }), perShareError);
    assert.equal(validateInput({ ...ok, payments: [p('2025-03-31', '')] }), perShareError);
    // 隣り合っていない重複も検出する
    assert.equal(
        validateInput({ ...ok, payments: [p('2025-03-31'), p('2025-09-30'), p('2025-03-31')] }),
        '同じ受取日が重複しています',
    );
    // 0 円の受取日は許可
    assert.equal(validateInput({ ...ok, payments: [p('2025-03-31', '0')] }), null);
});

test('buildPayments sorts by date and floors each amount', () => {
    assert.deepEqual(
        buildPayments(3, [
            { payDate: '2025-09-30', perShareText: '37.5' },
            { payDate: '2025-03-31', perShareText: '40' },
        ]),
        [
            { payDate: '2025-03-31', perShareCents: 4000, amount: 120 },
            { payDate: '2025-09-30', perShareCents: 3750, amount: 112 },
        ],
    );
    assert.deepEqual(buildPayments(1, [{ payDate: '2025-03-31', perShareText: '0.05' }]), [
        { payDate: '2025-03-31', perShareCents: 5, amount: 0 },
    ]);
});

test('isValidRecord / parseRecords', () => {
    assert.equal(isValidRecord(rec({})), true);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-03-31'), pay('2025-09-30')] })), true);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-01-01', 1000, 999)] })), false);
    assert.equal(isValidRecord(rec({ payments: [] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-03-31'), pay('2025-03-31')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-09-30'), pay('2025-03-31')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-02-30')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-01-01', -100, -1)] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-01-01', 1.5, 1)] })), false);
    assert.equal(isValidRecord(rec({ payments: days(MAX_PAYMENTS).map((d) => pay(d)) })), true);
    assert.equal(
        isValidRecord(rec({ payments: days(MAX_PAYMENTS + 1).map((d) => pay(d)) })),
        false,
    );
    assert.equal(isValidRecord(rec({ ownerId: 0 })), false);
    assert.equal(isValidRecord(rec({ ticker: '' })), false);
    assert.equal(isValidRecord(rec({ shares: 0, payments: [pay('2025-01-01', 1000, 0)] })), false);
    // 株数だけ変えて amount が合わなくなった記録は不正
    assert.equal(isValidRecord(rec({ shares: 200 })), false);
    const noUpdatedAt: Partial<DividendRecord> = rec({});
    delete noUpdatedAt.updatedAt;
    assert.equal(isValidRecord(noUpdatedAt), false);
    assert.equal(isValidRecord(null), false);
    assert.equal(isValidRecord('x'), false);

    assert.deepEqual(parseRecords(null), []);
    assert.deepEqual(parseRecords('{'), []);
    assert.deepEqual(parseRecords('{}'), []);
    const good = rec({ id: 'a' });
    assert.deepEqual(parseRecords(JSON.stringify([good, { id: 'b' }])), [good]);
});

test('migrateLegacyRecord converts v0.2 records', () => {
    const legacy = {
        id: 'old',
        ownerId: 2,
        ticker: '9432',
        name: 'NTT',
        payDate: '2024-09-27',
        shares: 3,
        perShareCents: 3750,
        amount: 112,
        createdBy: 1,
        createdAt: '2024-09-28T00:00:00.000Z',
    };
    const migrated = migrateLegacyRecord(legacy);
    assert.deepEqual(migrated, {
        id: 'old',
        ownerId: 2,
        ticker: '9432',
        name: 'NTT',
        shares: 3,
        payments: [{ payDate: '2024-09-27', perShareCents: 3750, amount: 112 }],
        createdBy: 1,
        createdAt: '2024-09-28T00:00:00.000Z',
        updatedAt: '2024-09-28T00:00:00.000Z',
    });
    assert.equal(isValidRecord(migrated), true);
    assert.equal(migrateLegacyRecord({ ...legacy, amount: 113 }), null);
    assert.equal(migrateLegacyRecord({ ...legacy, shares: '3' }), null);
    assert.equal(migrateLegacyRecord({ ...legacy, payDate: '2024-02-30' }), null);
    const missing: Partial<typeof legacy> = { ...legacy };
    delete missing.createdAt;
    assert.equal(migrateLegacyRecord(missing), null);
    assert.equal(migrateLegacyRecord(null), null);
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

test('yearlyTotals spreads payments of one record over years; recordTotal sums them', () => {
    const list = [
        rec({
            id: 'a',
            payments: [pay('2024-12-31', 1000, 1000), pay('2025-01-01', 1500, 1500)],
        }),
        rec({ id: 'b', shares: 50, payments: [pay('2025-03-01', 1000, 500)] }),
    ];
    assert.deepEqual(yearlyTotals(list), [
        { year: '2025', total: 2000 },
        { year: '2024', total: 1000 },
    ]);
    assert.deepEqual(yearlyTotals([]), []);
    assert.equal(recordTotal(list[0] as DividendRecord), 2500);
    assert.equal(recordTotal(rec({ payments: [pay('2025-01-01', 0, 0)] })), 0);
});

test('sortForList orders by ticker, owner, id without mutating', () => {
    const list = [
        rec({ id: 'c', ticker: '9432', ownerId: 1 }),
        rec({ id: 'b', ticker: '7203', ownerId: 2 }),
        rec({ id: 'z', ticker: '7203', ownerId: 1 }),
        rec({ id: 'a', ticker: '7203', ownerId: 1 }),
    ];
    assert.deepEqual(
        sortForList(list).map((r) => r.id),
        ['a', 'z', 'b', 'c'],
    );
    assert.deepEqual(
        list.map((r) => r.id),
        ['c', 'b', 'z', 'a'],
    );
});

test('formatPerShare', () => {
    assert.equal(formatPerShare(3750), '37.5円');
    assert.equal(formatPerShare(5), '0.05円');
    assert.equal(formatPerShare(120000), '1,200円');
    assert.equal(formatPerShare(0), '0円');
    assert.equal(formatPerShare(123456), '1,234.56円');
});

test('monthlyTotals sums payments per month of the given year', () => {
    const list = [
        rec({
            id: 'a',
            payments: [
                pay('2024-12-31', 1000, 1000),
                pay('2025-01-01', 1500, 1500),
                pay('2025-06-30', 1000, 1000),
                pay('2025-12-31', 1000, 1000),
            ],
        }),
        rec({ id: 'b', shares: 50, payments: [pay('2025-06-02', 1000, 500), pay('2026-01-01')] }),
        rec({ id: 'c', payments: [pay('2025-06-15', 0, 0)] }),
    ];
    const snapshot = JSON.stringify(list);
    const months = monthlyTotals(list, '2025');
    assert.equal(months.length, 12);
    assert.deepEqual(
        months.map((m) => m.month),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.deepEqual(
        months.map((m) => m.total),
        [1500, 0, 0, 0, 0, 1500, 0, 0, 0, 0, 0, 1000],
    );
    assert.deepEqual(
        monthlyTotals(list, '2024').map((m) => m.total),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000],
    );
    assert.deepEqual(
        monthlyTotals(list, '2030').map((m) => m.total),
        Array(12).fill(0),
    );
    assert.deepEqual(
        monthlyTotals([], '2025').map((m) => m.total),
        Array(12).fill(0),
    );
    assert.equal(JSON.stringify(list), snapshot);
});

test('monthlyTotals splits each month by owner', () => {
    const list = [
        rec({ id: 'a', ownerId: 2, payments: [pay('2025-06-02', 1000, 1000)] }),
        rec({ id: 'b', ownerId: 1, payments: [pay('2025-06-30', 1000, 1000)] }),
        // 同じ保有者の別記録は合算する
        rec({ id: 'c', ownerId: 2, shares: 50, payments: [pay('2025-06-15', 1000, 500)] }),
        // 0 円の保有者は内訳に入れない
        rec({ id: 'd', ownerId: 3, payments: [pay('2025-06-20', 0, 0), pay('2025-07-01')] }),
        // 他の年は含まない
        rec({ id: 'e', ownerId: 4, payments: [pay('2024-06-01')] }),
    ];
    const months = monthlyTotals(list, '2025');
    assert.deepEqual(months[5], {
        month: 6,
        total: 2500,
        owners: [
            { ownerId: 1, total: 1000 },
            { ownerId: 2, total: 1500 },
        ],
    });
    assert.deepEqual(months[6], { month: 7, total: 1000, owners: [{ ownerId: 3, total: 1000 }] });
    assert.deepEqual(months[0], { month: 1, total: 0, owners: [] });
    for (const m of months) {
        assert.equal(
            m.owners.reduce((sum, o) => sum + o.total, 0),
            m.total,
        );
    }
});

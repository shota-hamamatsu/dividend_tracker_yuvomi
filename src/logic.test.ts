import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    type DividendRecord,
    type YearlyTotal,
    CHART_YEARS,
    MAX_PAYMENTS,
    annualTotals,
    buildPayments,
    buildYearlyTotal,
    calcAmount,
    filterByOwner,
    formatAmount,
    formatPerShare,
    isCurrency,
    isValidDate,
    isValidPayDate,
    isValidRecord,
    isValidYearlyTotal,
    migrateLegacyRecord,
    migrateV3Record,
    migrateV4Record,
    migrateV4YearlyTotal,
    monthlyTotals,
    parsePerShare,
    parseRecords,
    parseShares,
    parseYear,
    perShareDecimals,
    perShareInputText,
    recordTotal,
    sortForList,
    usedCurrencies,
    validateInput,
    yearlyChart,
} from './logic.ts';

function rec(over: Partial<DividendRecord>): DividendRecord {
    return {
        id: 'x',
        ownerId: 1,
        currency: 'JPY',
        ticker: '7203',
        name: '',
        shares: 100,
        payments: [{ payDate: '01-01', perShareCents: 1000, amount: 1000 }],
        createdBy: 1,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        ...over,
    };
}

function pay(payDate: string, perShareCents = 1000, amount = 1000) {
    return { payDate, perShareCents, amount };
}

/** 01-01 から n 日分の月日 */
function days(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `01-${String(i + 1).padStart(2, '0')}`);
}

const JPY_3000 = {
    currency: 'JPY' as const,
    total: 3000,
    owners: [
        { ownerId: 1, total: 1000 },
        { ownerId: 2, total: 2000 },
    ],
};

function yt(over: Partial<YearlyTotal>): YearlyTotal {
    return {
        year: 2025,
        totals: [JPY_3000],
        registeredBy: 1,
        registeredAt: '2025-12-31T00:00:00.000Z',
        ...over,
    };
}

test('formatAmount: JPY groups by three digits, others show two decimals', () => {
    assert.equal(formatAmount(0, 'JPY'), '0円');
    assert.equal(formatAmount(999, 'JPY'), '999円');
    assert.equal(formatAmount(1000, 'JPY'), '1,000円');
    assert.equal(formatAmount(1234567, 'JPY'), '1,234,567円');
    assert.equal(formatAmount(123456, 'USD'), 'USD 1,234.56');
    assert.equal(formatAmount(5, 'USD'), 'USD 0.05');
    assert.equal(formatAmount(50, 'GBP'), 'GBP 0.50');
    assert.equal(formatAmount(0, 'EUR'), 'EUR 0.00');
    assert.equal(formatAmount(100_000_000_000, 'USD'), 'USD 1,000,000,000.00');
});

test('isCurrency / perShareDecimals', () => {
    for (const good of ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'HKD', 'CNY', 'SGD']) {
        assert.equal(isCurrency(good), true, good);
    }
    for (const bad of ['jpy', 'XYZ', '', ' USD', 1, null, undefined]) {
        assert.equal(isCurrency(bad), false, String(bad));
    }
    assert.equal(perShareDecimals('JPY'), 2);
    assert.equal(perShareDecimals('USD'), 4);
    assert.equal(perShareDecimals('SGD'), 4);
});

test('parseShares', () => {
    assert.equal(parseShares('1'), 1);
    assert.equal(parseShares('100'), 100);
    assert.equal(parseShares('10000000'), 10_000_000);
    for (const bad of ['', '0', '01', '-1', '1.5', '1e3', ' 1', 'abc', '10000001']) {
        assert.equal(parseShares(bad), null, bad);
    }
});

test('parsePerShare (JPY) converts to hundredths without floats', () => {
    assert.equal(parsePerShare('37.5', 'JPY'), 3750);
    assert.equal(parsePerShare('0.05', 'JPY'), 5);
    assert.equal(parsePerShare('12', 'JPY'), 1200);
    assert.equal(parsePerShare('0', 'JPY'), 0);
    assert.equal(parsePerShare('0.29', 'JPY'), 29); // 0.29*100 は浮動小数点だと 28.999...
    assert.equal(parsePerShare('100000', 'JPY'), 10_000_000);
    for (const bad of ['', '1.234', '-1', '1e3', ' 1', '.5', '1.', 'abc', '100000.01']) {
        assert.equal(parsePerShare(bad, 'JPY'), null, bad);
    }
});

test('parsePerShare (other currencies) converts to ten-thousandths without floats', () => {
    assert.equal(parsePerShare('0.2475', 'USD'), 2475);
    assert.equal(parsePerShare('0.26', 'USD'), 2600);
    assert.equal(parsePerShare('1', 'USD'), 10000);
    assert.equal(parsePerShare('0.0001', 'EUR'), 1);
    assert.equal(parsePerShare('0.0029', 'GBP'), 29);
    assert.equal(parsePerShare('1000', 'USD'), 10_000_000);
    for (const bad of ['', '0.12345', '1000.0001', '-1', '.5', '1.', '1e3', 'abc']) {
        assert.equal(parsePerShare(bad, 'USD'), null, bad);
    }
});

test('calcAmount floors below the amount unit', () => {
    assert.equal(calcAmount(3, 3750), 112); // 112.5 円 → 112 円
    assert.equal(calcAmount(100, 3750), 3750);
    assert.equal(calcAmount(1, 5), 0);
    assert.equal(calcAmount(10_000_000, 10_000_000), 1_000_000_000_000);
    // USD 0.2475 × 3 株 = USD 0.7425 → 1 セント未満切り捨てで 74 セント
    assert.equal(calcAmount(3, 2475), 74);
    // USD 0.26 × 50 株 = USD 13.00
    assert.equal(calcAmount(50, 2600), 1300);
});

test('isValidDate', () => {
    assert.equal(isValidDate('2024-02-29'), true);
    assert.equal(isValidDate('2025-12-31'), true);
    for (const bad of ['2025-02-29', '2025-02-30', '2025-13-01', '2025-00-10', '2025-1-1', '']) {
        assert.equal(isValidDate(bad), false, bad);
    }
});

test('isValidPayDate accepts month-day only', () => {
    for (const good of ['01-01', '02-29', '06-30', '12-31']) {
        assert.equal(isValidPayDate(good), true, good);
    }
    for (const bad of ['02-30', '04-31', '00-10', '13-01', '06-00', '6-30', '2025-06-30', '']) {
        assert.equal(isValidPayDate(bad), false, bad);
    }
});

test('validateInput', () => {
    const p = (payDate: string, perShareText = '10') => ({ payDate, perShareText });
    const ok = {
        ownerId: 1,
        currency: 'JPY',
        ticker: '7203',
        name: '',
        sharesText: '100',
        payments: [p('03-31', '37.5'), p('09-30', '40')],
    };
    const perShareError = '1株当たり配当は0以上、小数第2位までで入力してください';
    const dateError = '受取日を正しく選んでください';
    assert.equal(validateInput(ok), null);
    assert.equal(validateInput({ ...ok, ownerId: 0 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ownerId: 1.5 }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, currency: '' }), '通貨を選んでください');
    assert.equal(validateInput({ ...ok, currency: 'XYZ' }), '通貨を選んでください');
    // 保有者の判定が先
    assert.equal(validateInput({ ...ok, ownerId: 0, currency: 'XYZ' }), '保有者を選んでください');
    assert.equal(validateInput({ ...ok, ticker: '  ' }), '銘柄コードを入力してください');
    assert.equal(
        validateInput({ ...ok, sharesText: '0' }),
        '保有株数は1以上の整数で入力してください',
    );
    assert.equal(validateInput({ ...ok, payments: [] }), '受取日を1つ以上入力してください');
    const all = days(MAX_PAYMENTS + 1).map((d) => p(d));
    assert.equal(validateInput({ ...ok, payments: all.slice(0, MAX_PAYMENTS) }), null);
    assert.equal(validateInput({ ...ok, payments: all }), '受取日は24件までです');
    assert.equal(validateInput({ ...ok, payments: [p('03-31'), p('02-30')] }), dateError);
    assert.equal(validateInput({ ...ok, payments: [p('')] }), dateError);
    // 年付きの日付は受け付けない
    assert.equal(validateInput({ ...ok, payments: [p('2025-03-31')] }), dateError);
    assert.equal(validateInput({ ...ok, payments: [p('03-31', '1.234')] }), perShareError);
    assert.equal(validateInput({ ...ok, payments: [p('03-31', '')] }), perShareError);
    // 隣り合っていない重複も検出する
    assert.equal(
        validateInput({ ...ok, payments: [p('03-31'), p('09-30'), p('03-31')] }),
        '同じ受取日が重複しています',
    );
    // 0 円の受取日は許可
    assert.equal(validateInput({ ...ok, payments: [p('03-31', '0')] }), null);

    // JPY 以外は小数第4位まで
    const usd = { ...ok, currency: 'USD', payments: [p('02-13', '0.2475')] };
    assert.equal(validateInput(usd), null);
    assert.equal(
        validateInput({ ...usd, payments: [p('02-13', '0.12345')] }),
        '1株当たり配当は0以上、小数第4位までで入力してください',
    );
    assert.equal(validateInput({ ...ok, payments: [p('03-31', '0.123')] }), perShareError);
});

test('buildPayments sorts by date and floors each amount', () => {
    assert.deepEqual(
        buildPayments(
            3,
            [
                { payDate: '09-30', perShareText: '37.5' },
                { payDate: '03-31', perShareText: '40' },
            ],
            'JPY',
        ),
        [
            { payDate: '03-31', perShareCents: 4000, amount: 120 },
            { payDate: '09-30', perShareCents: 3750, amount: 112 },
        ],
    );
    assert.deepEqual(buildPayments(1, [{ payDate: '03-31', perShareText: '0.05' }], 'JPY'), [
        { payDate: '03-31', perShareCents: 5, amount: 0 },
    ]);
    assert.deepEqual(buildPayments(50, [{ payDate: '02-13', perShareText: '0.26' }], 'USD'), [
        { payDate: '02-13', perShareCents: 2600, amount: 1300 },
    ]);
    // 同じ文字列でも通貨で単位が変わる
    assert.deepEqual(buildPayments(3, [{ payDate: '02-13', perShareText: '0.2475' }], 'USD'), [
        { payDate: '02-13', perShareCents: 2475, amount: 74 },
    ]);
});

test('isValidRecord / parseRecords', () => {
    assert.equal(isValidRecord(rec({})), true);
    assert.equal(isValidRecord(rec({ payments: [pay('03-31'), pay('09-30')] })), true);
    assert.equal(isValidRecord(rec({ payments: [pay('01-01', 1000, 999)] })), false);
    assert.equal(isValidRecord(rec({ payments: [] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('03-31'), pay('03-31')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('09-30'), pay('03-31')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('02-30')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('2025-01-01')] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('01-01', -100, -1)] })), false);
    assert.equal(isValidRecord(rec({ payments: [pay('01-01', 1.5, 1)] })), false);
    assert.equal(isValidRecord(rec({ payments: days(MAX_PAYMENTS).map((d) => pay(d)) })), true);
    assert.equal(
        isValidRecord(rec({ payments: days(MAX_PAYMENTS + 1).map((d) => pay(d)) })),
        false,
    );
    assert.equal(isValidRecord(rec({ ownerId: 0 })), false);
    assert.equal(isValidRecord(rec({ ticker: '' })), false);
    assert.equal(isValidRecord(rec({ currency: 'USD' })), true);
    assert.equal(isValidRecord({ ...rec({}), currency: 'XYZ' }), false);
    const noCurrency: Partial<DividendRecord> = rec({});
    delete noCurrency.currency;
    assert.equal(isValidRecord(noCurrency), false);
    assert.equal(isValidRecord(rec({ shares: 0, payments: [pay('01-01', 1000, 0)] })), false);
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

/** 通貨を持たない記録（v0.4 以前の形）。 */
function withoutCurrency(record: DividendRecord): Partial<DividendRecord> {
    const copy: Partial<DividendRecord> = { ...record };
    delete copy.currency;
    return copy;
}

test('migrateV4Record adds JPY to v0.4 records', () => {
    const v4 = withoutCurrency(rec({ id: 'v4', payments: [pay('03-31'), pay('09-30')] }));
    const migrated = migrateV4Record(v4);
    assert.deepEqual(migrated, { ...v4, currency: 'JPY' });
    assert.equal(isValidRecord(migrated), true);
    // 元に通貨があっても JPY にする
    assert.equal(migrateV4Record(rec({ currency: 'USD' }))?.currency, 'JPY');
    assert.equal(migrateV4Record(withoutCurrency(rec({ shares: 200 }))), null);
    assert.equal(migrateV4Record(withoutCurrency(rec({ payments: [pay('2025-01-01')] }))), null);
    assert.equal(migrateV4Record(null), null);
});

test('migrateV3Record drops the year and keeps the newest year per month-day', () => {
    const v3 = rec({
        id: 'v3',
        shares: 100,
        payments: [
            pay('2024-06-03', 4500, 4500),
            pay('2024-11-27', 4500, 4500),
            pay('2025-03-31', 1000, 1000),
            pay('2025-06-03', 5000, 5000),
        ],
    });
    const migrated = migrateV3Record(withoutCurrency(v3));
    assert.deepEqual(migrated, {
        ...v3,
        currency: 'JPY',
        payments: [pay('03-31', 1000, 1000), pay('06-03', 5000, 5000), pay('11-27', 4500, 4500)],
    });
    assert.equal(isValidRecord(migrated), true);
    // 2024-02-29 は 02-29 として残る
    assert.deepEqual(migrateV3Record(rec({ payments: [pay('2024-02-29')] }))?.payments, [
        pay('02-29'),
    ]);
    // v0.3 として不正なもの
    assert.equal(migrateV3Record(rec({ payments: [pay('2025-01-01', 1000, 999)] })), null);
    assert.equal(migrateV3Record(rec({ payments: [pay('2025-09-30'), pay('2025-03-31')] })), null);
    assert.equal(migrateV3Record(rec({ payments: [pay('01-01')] })), null);
    assert.equal(migrateV3Record(null), null);
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
        currency: 'JPY',
        ticker: '9432',
        name: 'NTT',
        shares: 3,
        payments: [{ payDate: '09-27', perShareCents: 3750, amount: 112 }],
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

test('recordTotal and annualTotals sum one year of payments per owner', () => {
    const list = [
        rec({
            id: 'a',
            ownerId: 2,
            payments: [pay('03-31', 1000, 1000), pay('09-30', 1500, 1500)],
        }),
        rec({ id: 'b', ownerId: 1, shares: 50, payments: [pay('06-30', 1000, 500)] }),
        // 同じ保有者の別記録は合算する
        rec({ id: 'c', ownerId: 2, payments: [pay('12-01', 1000, 1000)] }),
        // 0 円の保有者は内訳に入れない
        rec({ id: 'd', ownerId: 3, payments: [pay('01-01', 0, 0)] }),
        // 通貨ごとに分ける（USD が先に並んでいても結果は通貨の順）
        rec({
            id: 'e',
            ownerId: 1,
            currency: 'USD',
            shares: 50,
            payments: [pay('02-13', 2600, 1300)],
        }),
        rec({ id: 'f', ownerId: 3, currency: 'EUR', payments: [pay('05-01', 0, 0)] }),
    ];
    assert.equal(recordTotal(list[0] as DividendRecord), 2500);
    const expected = [
        {
            currency: 'JPY',
            total: 4000,
            owners: [
                { ownerId: 1, total: 500 },
                { ownerId: 2, total: 3500 },
            ],
        },
        // 0 の通貨（EUR）は含めない
        { currency: 'USD', total: 1300, owners: [{ ownerId: 1, total: 1300 }] },
    ];
    assert.deepEqual(annualTotals(list), expected);
    assert.deepEqual(annualTotals([...list].reverse()), expected);
    assert.deepEqual(annualTotals([]), []);
    assert.deepEqual(buildYearlyTotal(list, 2026, 5, '2026-11-19T00:00:00.000Z'), {
        year: 2026,
        totals: expected,
        registeredBy: 5,
        registeredAt: '2026-11-19T00:00:00.000Z',
    });
    assert.equal(isValidYearlyTotal(buildYearlyTotal(list, 2026, 5, 'x')), true);
});

test('isValidYearlyTotal', () => {
    const usd = { currency: 'USD' as const, total: 500, owners: [{ ownerId: 1, total: 500 }] };
    /** JPY の内訳だけを差し替えた年別合計（形の検査用に unknown で返す）。 */
    const jpy = (over: Record<string, unknown>): unknown =>
        yt({ totals: [{ ...JPY_3000, ...over }] });
    assert.equal(isValidYearlyTotal(yt({})), true);
    assert.equal(isValidYearlyTotal(yt({ totals: [] })), true);
    assert.equal(isValidYearlyTotal(yt({ totals: [JPY_3000, usd] })), true);
    assert.equal(isValidYearlyTotal(yt({ totals: [usd] })), true);
    assert.equal(isValidYearlyTotal(yt({ year: 2000 })), true);
    assert.equal(isValidYearlyTotal(yt({ year: 2100 })), true);
    assert.equal(isValidYearlyTotal(yt({ year: 1999 })), false);
    assert.equal(isValidYearlyTotal(yt({ year: 2101 })), false);
    assert.equal(isValidYearlyTotal(yt({ year: 2025.5 })), false);
    // 通貨の順の逆転・重複・不正な通貨
    assert.equal(isValidYearlyTotal(yt({ totals: [usd, JPY_3000] })), false);
    assert.equal(isValidYearlyTotal(yt({ totals: [usd, usd] })), false);
    assert.equal(isValidYearlyTotal(jpy({ currency: 'XYZ' })), false);
    // 和の食い違い・0 の通貨・0 円の保有者・不正な ownerId・昇順でない owners
    assert.equal(isValidYearlyTotal(jpy({ total: 2999 })), false);
    assert.equal(isValidYearlyTotal(jpy({ total: 0, owners: [] })), false);
    assert.equal(
        isValidYearlyTotal(
            jpy({
                total: 1000,
                owners: [
                    { ownerId: 1, total: 1000 },
                    { ownerId: 2, total: 0 },
                ],
            }),
        ),
        false,
    );
    assert.equal(
        isValidYearlyTotal(jpy({ total: 1000, owners: [{ ownerId: 0, total: 1000 }] })),
        false,
    );
    assert.equal(
        isValidYearlyTotal(
            jpy({
                owners: [
                    { ownerId: 2, total: 2000 },
                    { ownerId: 1, total: 1000 },
                ],
            }),
        ),
        false,
    );
    assert.equal(isValidYearlyTotal(yt({ registeredBy: 0 })), false);
    // v0.4 の形は受け付けない
    const { currency: _currency, ...v4Fields } = JPY_3000;
    void _currency;
    assert.equal(
        isValidYearlyTotal({ year: 2025, ...v4Fields, registeredBy: 1, registeredAt: 'x' }),
        false,
    );
    assert.equal(isValidYearlyTotal(null), false);
});

test('migrateV4YearlyTotal converts the yen total', () => {
    const v4 = {
        year: 2024,
        total: 3000,
        owners: JPY_3000.owners,
        registeredBy: 2,
        registeredAt: '2024-12-31T00:00:00.000Z',
    };
    const migrated = migrateV4YearlyTotal(v4);
    assert.deepEqual(migrated, {
        year: 2024,
        totals: [JPY_3000],
        registeredBy: 2,
        registeredAt: '2024-12-31T00:00:00.000Z',
    });
    assert.equal(isValidYearlyTotal(migrated), true);
    assert.deepEqual(migrateV4YearlyTotal({ ...v4, total: 0, owners: [] })?.totals, []);
    assert.equal(migrateV4YearlyTotal({ ...v4, total: 2999 }), null);
    assert.equal(migrateV4YearlyTotal({ ...v4, year: 1999 }), null);
    assert.equal(migrateV4YearlyTotal({ ...v4, registeredBy: 0 }), null);
    assert.equal(migrateV4YearlyTotal(null), null);
});

test('parseYear', () => {
    assert.equal(parseYear('2026'), 2026);
    assert.equal(parseYear('2000'), 2000);
    assert.equal(parseYear('2100'), 2100);
    for (const bad of ['', '1999', '2101', '226', '20260', '2026.0', ' 2026', 'abcd']) {
        assert.equal(parseYear(bad), null, bad);
    }
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
    assert.equal(formatPerShare(3750, 'JPY'), '37.5円');
    assert.equal(formatPerShare(5, 'JPY'), '0.05円');
    assert.equal(formatPerShare(120000, 'JPY'), '1,200円');
    assert.equal(formatPerShare(0, 'JPY'), '0円');
    assert.equal(formatPerShare(123456, 'JPY'), '1,234.56円');
    assert.equal(formatPerShare(2475, 'USD'), 'USD 0.2475');
    assert.equal(formatPerShare(10000, 'USD'), 'USD 1');
    assert.equal(formatPerShare(2600, 'EUR'), 'EUR 0.26');
    assert.equal(formatPerShare(10_000_000, 'USD'), 'USD 1,000');
    assert.equal(formatPerShare(0, 'USD'), 'USD 0');
});

test('perShareInputText', () => {
    assert.equal(perShareInputText(3750, 'JPY'), '37.5');
    assert.equal(perShareInputText(5, 'JPY'), '0.05');
    assert.equal(perShareInputText(1200, 'JPY'), '12');
    assert.equal(perShareInputText(0, 'JPY'), '0');
    assert.equal(perShareInputText(120000, 'JPY'), '1200');
    assert.equal(perShareInputText(2475, 'USD'), '0.2475');
    assert.equal(perShareInputText(10000, 'USD'), '1');
    assert.equal(perShareInputText(2600, 'USD'), '0.26');
    assert.equal(perShareInputText(1, 'USD'), '0.0001');
    // 入力欄に戻した値をもう一度解析すると同じ値になる
    for (const [value, currency] of [
        [3750, 'JPY'],
        [7, 'JPY'],
        [2475, 'USD'],
        [10_000_000, 'GBP'],
    ] as const) {
        assert.equal(parsePerShare(perShareInputText(value, currency), currency), value);
    }
});

test('monthlyTotals sums payments per month', () => {
    const list = [
        rec({
            id: 'a',
            payments: [
                pay('01-01', 1500, 1500),
                pay('06-30', 1000, 1000),
                pay('12-31', 1000, 1000),
            ],
        }),
        rec({ id: 'b', shares: 50, payments: [pay('06-02', 1000, 500)] }),
        rec({ id: 'c', payments: [pay('06-15', 0, 0)] }),
    ];
    const snapshot = JSON.stringify(list);
    const months = monthlyTotals(list, 'JPY');
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
        monthlyTotals([], 'JPY').map((m) => m.total),
        Array(12).fill(0),
    );
    assert.equal(JSON.stringify(list), snapshot);
});

test('monthlyTotals splits each month by owner', () => {
    const list = [
        rec({ id: 'a', ownerId: 2, payments: [pay('06-02', 1000, 1000)] }),
        rec({ id: 'b', ownerId: 1, payments: [pay('06-30', 1000, 1000)] }),
        // 同じ保有者の別記録は合算する
        rec({ id: 'c', ownerId: 2, shares: 50, payments: [pay('06-15', 1000, 500)] }),
        // 0 円の保有者は内訳に入れない
        rec({ id: 'd', ownerId: 3, payments: [pay('06-20', 0, 0), pay('07-01')] }),
    ];
    const months = monthlyTotals(list, 'JPY');
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

test('monthlyTotals counts only the given currency', () => {
    const list = [
        rec({ id: 'a', payments: [pay('06-02', 1000, 1000)] }),
        rec({ id: 'b', currency: 'USD', shares: 50, payments: [pay('06-15', 2600, 1300)] }),
    ];
    assert.equal(monthlyTotals(list, 'JPY')[5]?.total, 1000);
    assert.deepEqual(monthlyTotals(list, 'USD')[5], {
        month: 6,
        total: 1300,
        owners: [{ ownerId: 1, total: 1300 }],
    });
    assert.deepEqual(
        monthlyTotals(list, 'EUR').map((m) => m.total),
        Array(12).fill(0),
    );
});

test('yearlyChart returns CHART_YEARS years ending at endYear, filtered by owner', () => {
    const usd = { currency: 'USD' as const, total: 700, owners: [{ ownerId: 2, total: 700 }] };
    const totals = [
        yt({ year: 2014 }), // 範囲外（2015〜2026）
        yt({
            year: 2020,
            totals: [{ currency: 'JPY', total: 1000, owners: [{ ownerId: 1, total: 1000 }] }],
        }),
        yt({ year: 2026, totals: [JPY_3000, usd] }),
    ];
    const snapshot = JSON.stringify(totals);
    const all = yearlyChart(totals, 2026, null, 'JPY');
    assert.equal(all.length, CHART_YEARS);
    assert.deepEqual(
        all.map((b) => b.year),
        [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    );
    assert.deepEqual(
        all.map((b) => b.total),
        [0, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 0, 3000],
    );
    assert.deepEqual(all[11]?.owners, [
        { ownerId: 1, total: 1000 },
        { ownerId: 2, total: 2000 },
    ]);
    assert.deepEqual(all[0]?.owners, []);

    const owner2 = yearlyChart(totals, 2026, 2, 'JPY');
    assert.deepEqual(
        owner2.map((b) => b.total),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2000],
    );
    assert.deepEqual(owner2[11]?.owners, [{ ownerId: 2, total: 2000 }]);
    assert.deepEqual(owner2[5], { year: 2020, total: 0, owners: [] });

    // 通貨ごと
    const dollars = yearlyChart(totals, 2026, null, 'USD');
    assert.deepEqual(
        dollars.map((b) => b.total),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 700],
    );
    assert.deepEqual(yearlyChart(totals, 2026, 1, 'USD')[11], { year: 2026, total: 0, owners: [] });
    assert.equal(JSON.stringify(totals), snapshot);
});

test('usedCurrencies collects currencies from records and yearly totals in order', () => {
    const records = [
        rec({ id: 'a', currency: 'USD' }),
        rec({ id: 'b' }),
        rec({ id: 'c', currency: 'USD' }),
    ];
    const totals = [
        yt({ totals: [{ currency: 'EUR', total: 1, owners: [{ ownerId: 1, total: 1 }] }] }),
        yt({ totals: [] }),
    ];
    assert.deepEqual(usedCurrencies(records, totals), ['JPY', 'USD', 'EUR']);
    assert.deepEqual(usedCurrencies([], totals), ['EUR']);
    assert.deepEqual(usedCurrencies([], []), []);
});

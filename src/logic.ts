export const CURRENCIES = [
    'JPY',
    'USD',
    'EUR',
    'GBP',
    'AUD',
    'CAD',
    'CHF',
    'HKD',
    'CNY',
    'SGD',
] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Payment {
    payDate: string; // MM-DD（毎年この月日に受け取る）
    // 1株当たり配当。amount の単位の 1/100 の整数（JPY は 1/100 円、JPY 以外は 1/10000）
    perShareCents: number;
    // 受取額 = calcAmount(record.shares, perShareCents)。JPY は円、JPY 以外は 1/100（セント等）
    amount: number;
}

export interface DividendRecord {
    id: string;
    ownerId: number; // 株を保有している yuvomi ユーザーの id
    currency: Currency;
    ticker: string;
    name: string;
    shares: number; // 保有株数（1 以上の整数）。全受取日で共通
    payments: Payment[]; // 1 件以上 MAX_PAYMENTS 件以下。payDate の昇順で重複なし
    createdBy: number;
    createdAt: string; // ISO 8601
    updatedAt: string; // ISO 8601
}

export interface PaymentInput {
    payDate: string;
    perShareText: string;
}

export interface RecordInput {
    ownerId: number;
    currency: string;
    ticker: string;
    name: string;
    sharesText: string;
    payments: PaymentInput[];
}

export interface OwnerTotal {
    ownerId: number;
    total: number; // amount の単位。1 以上
}

/** 合計と保有者ごとの内訳（owners は ownerId の昇順、0 の保有者は含めない）。 */
export interface Breakdown {
    total: number; // owners の total の和
    owners: OwnerTotal[];
}

export interface CurrencyBreakdown extends Breakdown {
    currency: Currency;
}

/** 利用者が年を指定して登録した、その年の配当合計（登録時点の記録の 1 年分）。 */
export interface YearlyTotal {
    year: number; // MIN_YEAR〜MAX_YEAR
    totals: CurrencyBreakdown[]; // 通貨の順で重複なし。total が 0 の通貨は含めない
    registeredBy: number;
    registeredAt: string; // ISO 8601
}

const MAX_SHARES = 10_000_000;
const MAX_PER_SHARE_CENTS = 10_000_000; // JPY は 100,000 円、JPY 以外は 1,000
export const MAX_PAYMENTS = 24;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
export const CHART_YEARS = 12;

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function isCurrency(value: unknown): value is Currency {
    return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** 1株配当の小数の桁数。 */
export function perShareDecimals(currency: Currency): number {
    return currency === 'JPY' ? 2 : 4;
}

export function parseShares(text: string): number | null {
    if (!/^[1-9]\d*$/.test(text)) return null;
    const value = Number(text);
    return value <= MAX_SHARES ? value : null;
}

export function parsePerShare(text: string, currency: Currency): number | null {
    const decimals = perShareDecimals(currency);
    const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(text);
    if (!match) return null;
    const units =
        BigInt(match[1] ?? '0') * 10n ** BigInt(decimals) +
        BigInt((match[2] ?? '').padEnd(decimals, '0'));
    return units <= BigInt(MAX_PER_SHARE_CENTS) ? Number(units) : null;
}

/** 受取額。amount の単位（JPY は 1 円、JPY 以外は 1/100）未満は切り捨て。 */
export function calcAmount(shares: number, perShareCents: number): number {
    return Number((BigInt(shares) * BigInt(perShareCents)) / 100n);
}

export function isValidDate(text: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/** 'MM-DD' がうるう年（2000 年）に実在する月日か。 */
export function isValidPayDate(text: string): boolean {
    return /^\d{2}-\d{2}$/.test(text) && isValidDate(`2000-${text}`);
}

export type InputErrorCode =
    | 'owner_required'
    | 'currency_required'
    | 'ticker_required'
    | 'shares_invalid'
    | 'payments_required'
    | 'payments_too_many'
    | 'pay_date_invalid'
    | 'per_share_invalid'
    | 'pay_date_duplicate';

/** 入力エラー。文言は画面が code で翻訳する（locales の errors.<code>）。 */
export interface InputError {
    code: InputErrorCode;
    params?: Record<string, number>; // payments_too_many: { max }、per_share_invalid: { decimals }
}

export function validateInput(input: RecordInput): InputError | null {
    if (!isPositiveInt(input.ownerId)) return { code: 'owner_required' };
    const { currency } = input;
    if (!isCurrency(currency)) return { code: 'currency_required' };
    if (input.ticker.trim() === '') return { code: 'ticker_required' };
    if (parseShares(input.sharesText) === null) return { code: 'shares_invalid' };
    if (input.payments.length === 0) return { code: 'payments_required' };
    if (input.payments.length > MAX_PAYMENTS) {
        return { code: 'payments_too_many', params: { max: MAX_PAYMENTS } };
    }
    for (const payment of input.payments) {
        if (!isValidPayDate(payment.payDate)) return { code: 'pay_date_invalid' };
        if (parsePerShare(payment.perShareText, currency) === null) {
            return { code: 'per_share_invalid', params: { decimals: perShareDecimals(currency) } };
        }
    }
    const dates = new Set(input.payments.map((p) => p.payDate));
    if (dates.size !== input.payments.length) return { code: 'pay_date_duplicate' };
    return null;
}

/** validateInput を通った入力から payments を作る（payDate の昇順）。 */
export function buildPayments(
    shares: number,
    inputs: PaymentInput[],
    currency: Currency,
): Payment[] {
    return inputs
        .map(({ payDate, perShareText }) => {
            const perShareCents = parsePerShare(perShareText, currency) ?? 0;
            return { payDate, perShareCents, amount: calcAmount(shares, perShareCents) };
        })
        .sort((a, b) => compareText(a.payDate, b.payDate));
}

function isValidShares(value: unknown): value is number {
    return isPositiveInt(value) && value <= MAX_SHARES;
}

function isValidPerShareCents(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= MAX_PER_SHARE_CENTS
    );
}

function isValidPayment(
    value: unknown,
    shares: number,
    isDate: (text: string) => boolean,
): value is Payment {
    if (typeof value !== 'object' || value === null) return false;
    const p = value as Record<string, unknown>;
    const { perShareCents } = p;
    return (
        typeof p['payDate'] === 'string' &&
        isDate(p['payDate']) &&
        isValidPerShareCents(perShareCents) &&
        p['amount'] === calcAmount(shares, perShareCents)
    );
}

/** 通貨を持たない記録（v0.4 以前の形）。 */
type RecordWithoutCurrency = Omit<DividendRecord, 'currency'>;

/**
 * 記録の形を調べる（通貨は調べない）。
 * 日付の形式（v0.4 以降は MM-DD、v0.3 は YYYY-MM-DD）だけ差し替えられる。
 */
function isRecordShape(
    value: unknown,
    isDate: (text: string) => boolean,
): value is RecordWithoutCurrency {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    const { shares, payments } = r;
    if (!isValidShares(shares)) return false;
    if (!Array.isArray(payments) || payments.length === 0 || payments.length > MAX_PAYMENTS) {
        return false;
    }
    for (let i = 0; i < payments.length; i++) {
        const payment: unknown = payments[i];
        if (!isValidPayment(payment, shares, isDate)) return false;
        if (i > 0 && (payments[i - 1] as Payment).payDate >= payment.payDate) return false;
    }
    return (
        typeof r['id'] === 'string' &&
        isPositiveInt(r['ownerId']) &&
        typeof r['ticker'] === 'string' &&
        r['ticker'] !== '' &&
        typeof r['name'] === 'string' &&
        isPositiveInt(r['createdBy']) &&
        typeof r['createdAt'] === 'string' &&
        typeof r['updatedAt'] === 'string'
    );
}

/** 移行した記録を v0.5 の形にする（通貨は JPY、項目は v0.5 の分だけ）。 */
function toJpyRecord(r: RecordWithoutCurrency): DividendRecord {
    return {
        id: r.id,
        ownerId: r.ownerId,
        currency: 'JPY',
        ticker: r.ticker,
        name: r.name,
        shares: r.shares,
        payments: r.payments,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

export function isValidRecord(value: unknown): value is DividendRecord {
    return (
        isRecordShape(value, isValidPayDate) &&
        isCurrency((value as unknown as Record<string, unknown>)['currency'])
    );
}

/** v0.4 形式（通貨なし）の記録に JPY を付ける。不正なら null。 */
export function migrateV4Record(value: unknown): DividendRecord | null {
    return isRecordShape(value, isValidPayDate) ? toJpyRecord(value) : null;
}

/**
 * v0.3 形式（payDate が YYYY-MM-DD）の記録を v0.5 形式（MM-DD、JPY）に変換する。不正なら null。
 * 同じ月日が複数あれば、最も新しい年のものを残す。
 */
export function migrateV3Record(value: unknown): DividendRecord | null {
    if (!isRecordShape(value, isValidDate)) return null;
    // payments は年月日の昇順なので、後のもの（新しい年）で上書きすれば新しい年が残る
    const byDay = new Map<string, Payment>();
    for (const payment of value.payments) {
        const payDate = payment.payDate.substring(5);
        byDay.set(payDate, { ...payment, payDate });
    }
    const payments = [...byDay.values()].sort((a, b) => compareText(a.payDate, b.payDate));
    return toJpyRecord({ ...value, payments });
}

/** v0.2 形式（payDate を 1 つだけ持つ記録）を v0.5 形式（JPY）に変換する。不正なら null。 */
export function migrateLegacyRecord(value: unknown): DividendRecord | null {
    if (typeof value !== 'object' || value === null) return null;
    const r = value as Record<string, unknown>;
    const {
        id,
        ownerId,
        ticker,
        name,
        payDate,
        shares,
        perShareCents,
        amount,
        createdBy,
        createdAt,
    } = r;
    if (
        typeof id !== 'string' ||
        !isPositiveInt(ownerId) ||
        typeof ticker !== 'string' ||
        ticker === '' ||
        typeof name !== 'string' ||
        typeof payDate !== 'string' ||
        !isValidDate(payDate) ||
        !isValidShares(shares) ||
        !isValidPerShareCents(perShareCents) ||
        amount !== calcAmount(shares, perShareCents) ||
        !isPositiveInt(createdBy) ||
        typeof createdAt !== 'string'
    ) {
        return null;
    }
    return {
        id,
        ownerId,
        currency: 'JPY',
        ticker,
        name,
        shares,
        payments: [{ payDate: payDate.substring(5), perShareCents, amount }],
        createdBy,
        createdAt,
        updatedAt: createdAt,
    };
}

export function parseRecords(json: string | null): DividendRecord[] {
    if (json === null) return [];
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter(isValidRecord) : [];
    } catch {
        return [];
    }
}

export function filterByOwner(records: DividendRecord[], ownerId: number | null): DividendRecord[] {
    return ownerId === null ? [...records] : records.filter((r) => r.ownerId === ownerId);
}

export function recordTotal(record: DividendRecord): number {
    return record.payments.reduce((sum, p) => sum + p.amount, 0);
}

function toBreakdown(byOwner: Map<number, number>): Breakdown {
    const owners = Array.from(byOwner, ([ownerId, total]) => ({ ownerId, total }))
        .filter((o) => o.total > 0)
        .sort((a, b) => a.ownerId - b.ownerId);
    return { total: owners.reduce((sum, o) => sum + o.total, 0), owners };
}

/** 記録の 1 年分の受取額の合計と保有者ごとの内訳を、通貨ごとに（通貨の順、0 の通貨は除く）。 */
export function annualTotals(records: DividendRecord[]): CurrencyBreakdown[] {
    const result: CurrencyBreakdown[] = [];
    for (const currency of CURRENCIES) {
        const byOwner = new Map<number, number>();
        for (const record of records) {
            if (record.currency !== currency) continue;
            byOwner.set(record.ownerId, (byOwner.get(record.ownerId) ?? 0) + recordTotal(record));
        }
        const breakdown = toBreakdown(byOwner);
        if (breakdown.total > 0) result.push({ currency, ...breakdown });
    }
    return result;
}

export function buildYearlyTotal(
    records: DividendRecord[],
    year: number,
    registeredBy: number,
    registeredAt: string,
): YearlyTotal {
    return { year, totals: annualTotals(records), registeredBy, registeredAt };
}

function isValidYear(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= MIN_YEAR &&
        value <= MAX_YEAR
    );
}

/** owners が ownerId の厳密な昇順・各 total が 1 以上で、total がその和なら true。 */
function isValidBreakdown(owners: unknown, total: unknown): boolean {
    if (!Array.isArray(owners)) return false;
    let sum = 0;
    let previous = 0;
    for (const item of owners as unknown[]) {
        if (typeof item !== 'object' || item === null) return false;
        const o = item as Record<string, unknown>;
        if (!isPositiveInt(o['ownerId']) || !isPositiveInt(o['total'])) return false;
        if (o['ownerId'] <= previous) return false;
        previous = o['ownerId'];
        sum += o['total'];
    }
    return total === sum;
}

function isValidRegistration(t: Record<string, unknown>): boolean {
    return (
        isValidYear(t['year']) &&
        isPositiveInt(t['registeredBy']) &&
        typeof t['registeredAt'] === 'string'
    );
}

export function isValidYearlyTotal(value: unknown): value is YearlyTotal {
    if (typeof value !== 'object' || value === null) return false;
    const t = value as Record<string, unknown>;
    const { totals } = t;
    if (!Array.isArray(totals) || !isValidRegistration(t)) return false;
    let previous = -1;
    for (const item of totals as unknown[]) {
        if (typeof item !== 'object' || item === null) return false;
        const c = item as Record<string, unknown>;
        if (!isCurrency(c['currency'])) return false;
        const index = CURRENCIES.indexOf(c['currency']);
        if (index <= previous) return false;
        previous = index;
        if (!isPositiveInt(c['total']) || !isValidBreakdown(c['owners'], c['total'])) return false;
    }
    return true;
}

/** v0.4 形式（{ year, total, owners, ... } の円の合計）を v0.5 形式にする。不正なら null。 */
export function migrateV4YearlyTotal(value: unknown): YearlyTotal | null {
    if (typeof value !== 'object' || value === null) return null;
    const t = value as Record<string, unknown>;
    const { year, total, owners, registeredBy, registeredAt } = t;
    if (!isValidRegistration(t) || !isValidBreakdown(owners, total)) return null;
    const jpy = {
        currency: 'JPY' as const,
        total: total as number,
        owners: owners as OwnerTotal[],
    };
    return {
        year: year as number,
        totals: jpy.total > 0 ? [{ ...jpy, owners: jpy.owners.map((o) => ({ ...o })) }] : [],
        registeredBy: registeredBy as number,
        registeredAt: registeredAt as string,
    };
}

/** 'YYYY' を MIN_YEAR〜MAX_YEAR の整数にする。それ以外は null。 */
export function parseYear(text: string): number | null {
    if (!/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    return isValidYear(year) ? year : null;
}

export interface MonthlyTotal extends Breakdown {
    month: number; // 1〜12
}

/** 1〜12 月それぞれの、その通貨の受取額の合計（記録の 1 年分）と、保有者ごとの内訳。 */
export function monthlyTotals(records: DividendRecord[], currency: Currency): MonthlyTotal[] {
    const byOwner = Array.from({ length: 12 }, () => new Map<number, number>());
    for (const record of records) {
        if (record.currency !== currency) continue;
        for (const payment of record.payments) {
            const owners = byOwner[Number(payment.payDate.substring(0, 2)) - 1];
            if (!owners) continue;
            owners.set(record.ownerId, (owners.get(record.ownerId) ?? 0) + payment.amount);
        }
    }
    return byOwner.map((owners, i) => ({ month: i + 1, ...toBreakdown(owners) }));
}

export interface YearlyBar extends Breakdown {
    year: number;
}

/**
 * 年別グラフ用。endYear までの CHART_YEARS 年分を年の昇順で返す。登録の無い年・通貨は 0。
 * ownerId が null でなければ、その保有者の分だけにする。
 */
export function yearlyChart(
    totals: YearlyTotal[],
    endYear: number,
    ownerId: number | null,
    currency: Currency,
): YearlyBar[] {
    return Array.from({ length: CHART_YEARS }, (_, i) => {
        const year = endYear - CHART_YEARS + 1 + i;
        const breakdown = totals
            .find((t) => t.year === year)
            ?.totals.find((c) => c.currency === currency);
        const owners = (breakdown?.owners ?? [])
            .filter((o) => ownerId === null || o.ownerId === ownerId)
            .map((o) => ({ ...o }));
        return { year, total: owners.reduce((sum, o) => sum + o.total, 0), owners };
    });
}

/** 記録と年別合計に出てくる通貨（重複なし、通貨の順）。 */
export function usedCurrencies(records: DividendRecord[], totals: YearlyTotal[]): Currency[] {
    const used = new Set<Currency>(records.map((r) => r.currency));
    for (const t of totals) {
        for (const c of t.totals) used.add(c.currency);
    }
    return CURRENCIES.filter((c) => used.has(c));
}

/** 一覧表示用。ticker → ownerId → id の昇順。 */
export function sortForList(records: DividendRecord[]): DividendRecord[] {
    return [...records].sort(
        (a, b) =>
            compareText(a.ticker, b.ticker) || a.ownerId - b.ownerId || compareText(a.id, b.id),
    );
}

/** 0 以上の整数を、小数 decimals 桁の固定小数として整数部と小数部の文字列に分ける。 */
function splitFixed(value: number, decimals: number): [string, string] {
    const digits = String(value).padStart(decimals + 1, '0');
    return [digits.slice(0, digits.length - decimals), digits.slice(digits.length - decimals)];
}

/** 金額の小数の桁数（JPY は 0、それ以外は 2）。 */
export function amountDecimals(currency: Currency): number {
    return currency === 'JPY' ? 0 : 2;
}

/**
 * 金額を小数の文字列にする（1234 JPY → '1234'、123456 USD → '1234.56'）。
 * 3 桁区切り・通貨記号は付けない（表示は画面が Intl で整える）。
 */
export function amountDecimal(amount: number, currency: Currency): string {
    const decimals = amountDecimals(currency);
    if (decimals === 0) return String(amount);
    const [whole, fraction] = splitFixed(amount, decimals);
    return `${whole}.${fraction}`;
}

/** 1株配当を入力欄用の文字列に戻す（3750 JPY → '37.5'、2475 USD → '0.2475'）。 */
export function perShareInputText(perShareCents: number, currency: Currency): string {
    const [whole, fraction] = splitFixed(perShareCents, perShareDecimals(currency));
    const trimmed = fraction.replace(/0+$/, '');
    return trimmed === '' ? whole : `${whole}.${trimmed}`;
}

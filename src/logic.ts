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
    payDate: string; // MM-DD (received on this month and day every year)
    // Dividend per share, as an integer in 1/100 of the amount unit (JPY: 1/100 yen, others: 1/10000)
    perShareCents: number;
    // Amount received = calcAmount(record.shares, perShareCents). JPY: yen, others: 1/100 (cents etc.)
    amount: number;
}

export interface DividendRecord {
    id: string;
    ownerId: number; // id of the yuvomi user who holds the shares
    currency: Currency;
    ticker: string;
    name: string;
    shares: number; // shares held (integer, 1 or more), shared by all pay dates
    payments: Payment[]; // 1 to MAX_PAYMENTS items, ascending by payDate, no duplicates
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
    total: number; // in the amount unit, 1 or more
}

/** A total and its breakdown by holder (owners ascending by ownerId, holders with 0 omitted). */
export interface Breakdown {
    total: number; // sum of the owners' totals
    owners: OwnerTotal[];
}

export interface CurrencyBreakdown extends Breakdown {
    currency: Currency;
}

/** The dividend total a user registered for a year (one year of the records at that moment). */
export interface YearlyTotal {
    year: number; // MIN_YEAR to MAX_YEAR
    totals: CurrencyBreakdown[]; // in currency order, no duplicates, currencies with 0 omitted
    registeredBy: number;
    registeredAt: string; // ISO 8601
}

const MAX_SHARES = 10_000_000;
const MAX_PER_SHARE_CENTS = 10_000_000; // JPY: 100,000 yen, others: 1,000
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

/** Number of decimal places for the dividend per share. */
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

/** Amount received, floored to the amount unit (JPY: 1 yen, others: 1/100). */
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

/** Whether 'MM-DD' is a real day in a leap year (2000). */
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

/** An input error. The UI translates it by code (errors.<code> in locales). */
export interface InputError {
    code: InputErrorCode;
    params?: Record<string, number>; // payments_too_many: { max }, per_share_invalid: { decimals }
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

/** Builds payments from input that passed validateInput (ascending by payDate). */
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

/** A record without a currency (the shape up to v0.4). */
type RecordWithoutCurrency = Omit<DividendRecord, 'currency'>;

/**
 * Checks the shape of a record (not its currency).
 * Only the date format can vary (MM-DD from v0.4, YYYY-MM-DD in v0.3).
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

/** Turns a migrated record into the v0.5 shape (JPY, only the v0.5 fields). */
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

/** Adds JPY to a v0.4 record (no currency). Returns null if it is invalid. */
export function migrateV4Record(value: unknown): DividendRecord | null {
    return isRecordShape(value, isValidPayDate) ? toJpyRecord(value) : null;
}

/**
 * Converts a v0.3 record (payDate is YYYY-MM-DD) to v0.5 (MM-DD, JPY). Returns null if it is invalid.
 * When the same month and day appears in several years, the newest year is kept.
 */
export function migrateV3Record(value: unknown): DividendRecord | null {
    if (!isRecordShape(value, isValidDate)) return null;
    // payments are in date order, so later (newer) entries overwrite older ones
    const byDay = new Map<string, Payment>();
    for (const payment of value.payments) {
        const payDate = payment.payDate.substring(5);
        byDay.set(payDate, { ...payment, payDate });
    }
    const payments = [...byDay.values()].sort((a, b) => compareText(a.payDate, b.payDate));
    return toJpyRecord({ ...value, payments });
}

/** Converts a v0.2 record (a single payDate) to v0.5 (JPY). Returns null if it is invalid. */
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

/** One year of amounts with a breakdown by holder, per currency (in currency order, 0 omitted). */
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

/** True when owners are strictly ascending by ownerId, each total is 1 or more, and total is their sum. */
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

/** Converts a v0.4 yearly total ({ year, total, owners, ... } in yen) to v0.5. Returns null if it is invalid. */
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

/** Parses 'YYYY' into an integer from MIN_YEAR to MAX_YEAR, otherwise null. */
export function parseYear(text: string): number | null {
    if (!/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    return isValidYear(year) ? year : null;
}

export interface MonthlyTotal extends Breakdown {
    month: number; // 1 to 12
}

/** For each month 1 to 12, the total in that currency (one year of records) with a breakdown by holder. */
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
 * For the yearly chart: CHART_YEARS years up to endYear, ascending. Years or currencies not registered are 0.
 * When ownerId is not null, only that holder is counted.
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

/** Currencies used in the records and yearly totals (no duplicates, in currency order). */
export function usedCurrencies(records: DividendRecord[], totals: YearlyTotal[]): Currency[] {
    const used = new Set<Currency>(records.map((r) => r.currency));
    for (const t of totals) {
        for (const c of t.totals) used.add(c.currency);
    }
    return CURRENCIES.filter((c) => used.has(c));
}

/** For the list: ascending by ticker, then ownerId, then id. */
export function sortForList(records: DividendRecord[]): DividendRecord[] {
    return [...records].sort(
        (a, b) =>
            compareText(a.ticker, b.ticker) || a.ownerId - b.ownerId || compareText(a.id, b.id),
    );
}

/** Splits a non-negative integer, read as a fixed-point number with `decimals` places, into whole and fraction strings. */
function splitFixed(value: number, decimals: number): [string, string] {
    const digits = String(value).padStart(decimals + 1, '0');
    return [digits.slice(0, digits.length - decimals), digits.slice(digits.length - decimals)];
}

/** Decimal places of an amount (JPY: 0, others: 2). */
export function amountDecimals(currency: Currency): number {
    return currency === 'JPY' ? 0 : 2;
}

/**
 * Writes an amount as a decimal string (1234 JPY → '1234', 123456 USD → '1234.56').
 * No grouping or currency symbol; the UI formats it with Intl.
 */
export function amountDecimal(amount: number, currency: Currency): string {
    const decimals = amountDecimals(currency);
    if (decimals === 0) return String(amount);
    const [whole, fraction] = splitFixed(amount, decimals);
    return `${whole}.${fraction}`;
}

/** Turns a dividend per share back into input text (3750 JPY → '37.5', 2475 USD → '0.2475'). */
export function perShareInputText(perShareCents: number, currency: Currency): string {
    const [whole, fraction] = splitFixed(perShareCents, perShareDecimals(currency));
    const trimmed = fraction.replace(/0+$/, '');
    return trimmed === '' ? whole : `${whole}.${trimmed}`;
}

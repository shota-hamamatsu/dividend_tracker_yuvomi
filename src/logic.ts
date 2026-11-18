export interface Payment {
    payDate: string; // YYYY-MM-DD
    perShareCents: number; // 1株当たり配当（1/100 円単位の整数）
    amount: number; // 受取額（円）= calcAmount(record.shares, perShareCents)
}

export interface DividendRecord {
    id: string;
    ownerId: number; // 株を保有している yuvomi ユーザーの id
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
    ticker: string;
    name: string;
    sharesText: string;
    payments: PaymentInput[];
}

const MAX_SHARES = 10_000_000;
const MAX_PER_SHARE_CENTS = 10_000_000; // 100,000円
export const MAX_PAYMENTS = 24;

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function groupDigits(digits: string): string {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseShares(text: string): number | null {
    if (!/^[1-9]\d*$/.test(text)) return null;
    const value = Number(text);
    return value <= MAX_SHARES ? value : null;
}

export function parsePerShare(text: string): number | null {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    const cents = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
    return cents <= BigInt(MAX_PER_SHARE_CENTS) ? Number(cents) : null;
}

/** 受取額（円）。1円未満は切り捨て。 */
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

export function validateInput(input: RecordInput): string | null {
    if (!isPositiveInt(input.ownerId)) return '保有者を選んでください';
    if (input.ticker.trim() === '') return '銘柄コードを入力してください';
    if (parseShares(input.sharesText) === null) return '保有株数は1以上の整数で入力してください';
    if (input.payments.length === 0) return '受取日を1つ以上入力してください';
    if (input.payments.length > MAX_PAYMENTS) return `受取日は${MAX_PAYMENTS}件までです`;
    for (const payment of input.payments) {
        if (!isValidDate(payment.payDate)) return '受取日を入力してください';
        if (parsePerShare(payment.perShareText) === null) {
            return '1株当たり配当は0以上、小数第2位までで入力してください';
        }
    }
    const dates = new Set(input.payments.map((p) => p.payDate));
    if (dates.size !== input.payments.length) return '同じ受取日が重複しています';
    return null;
}

/** validateInput を通った入力から payments を作る（payDate の昇順）。 */
export function buildPayments(shares: number, inputs: PaymentInput[]): Payment[] {
    return inputs
        .map(({ payDate, perShareText }) => {
            const perShareCents = parsePerShare(perShareText) ?? 0;
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

function isValidPayment(value: unknown, shares: number): value is Payment {
    if (typeof value !== 'object' || value === null) return false;
    const p = value as Record<string, unknown>;
    const { perShareCents } = p;
    return (
        typeof p['payDate'] === 'string' &&
        isValidDate(p['payDate']) &&
        isValidPerShareCents(perShareCents) &&
        p['amount'] === calcAmount(shares, perShareCents)
    );
}

export function isValidRecord(value: unknown): value is DividendRecord {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    const { shares, payments } = r;
    if (!isValidShares(shares)) return false;
    if (!Array.isArray(payments) || payments.length === 0 || payments.length > MAX_PAYMENTS) {
        return false;
    }
    for (let i = 0; i < payments.length; i++) {
        const payment: unknown = payments[i];
        if (!isValidPayment(payment, shares)) return false;
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

/** v0.2 形式（payDate を 1 つだけ持つ記録）を v0.3 形式に変換する。不正なら null。 */
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
        ticker,
        name,
        shares,
        payments: [{ payDate, perShareCents, amount }],
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

export function yearlyTotals(records: DividendRecord[]): { year: string; total: number }[] {
    const totals = new Map<string, number>();
    for (const record of records) {
        for (const payment of record.payments) {
            const year = payment.payDate.substring(0, 4);
            totals.set(year, (totals.get(year) ?? 0) + payment.amount);
        }
    }
    return Array.from(totals, ([year, total]) => ({ year, total })).sort(
        (a, b) => -compareText(a.year, b.year),
    );
}

/** 指定した年（'YYYY'）の 1〜12 月それぞれの受取額の合計。 */
export function monthlyTotals(
    records: DividendRecord[],
    year: string,
): { month: number; total: number }[] {
    const totals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
    for (const record of records) {
        for (const payment of record.payments) {
            if (payment.payDate.substring(0, 4) !== year) continue;
            const entry = totals[Number(payment.payDate.substring(5, 7)) - 1];
            if (entry) entry.total += payment.amount;
        }
    }
    return totals;
}

/** 一覧表示用。ticker → ownerId → id の昇順。 */
export function sortForList(records: DividendRecord[]): DividendRecord[] {
    return [...records].sort(
        (a, b) =>
            compareText(a.ticker, b.ticker) || a.ownerId - b.ownerId || compareText(a.id, b.id),
    );
}

export function formatYen(amount: number): string {
    return groupDigits(String(amount)) + '円';
}

export function formatPerShare(cents: number): string {
    const yen = groupDigits(String(Math.trunc(cents / 100)));
    const fraction = String(cents % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
    return fraction === '' ? `${yen}円` : `${yen}.${fraction}円`;
}

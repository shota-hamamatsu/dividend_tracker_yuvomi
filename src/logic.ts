export interface Payment {
    payDate: string; // MM-DD（毎年この月日に受け取る）
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

export interface OwnerTotal {
    ownerId: number;
    total: number; // 円。1 以上
}

/** 合計と保有者ごとの内訳（owners は ownerId の昇順、0 円の保有者は含めない）。 */
export interface Breakdown {
    total: number; // 円。owners の total の和
    owners: OwnerTotal[];
}

/** 利用者が年を指定して登録した、その年の配当合計（登録時点の記録の 1 年分）。 */
export interface YearlyTotal extends Breakdown {
    year: number; // MIN_YEAR〜MAX_YEAR
    registeredBy: number;
    registeredAt: string; // ISO 8601
}

const MAX_SHARES = 10_000_000;
const MAX_PER_SHARE_CENTS = 10_000_000; // 100,000円
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

/** 'MM-DD' がうるう年（2000 年）に実在する月日か。 */
export function isValidPayDate(text: string): boolean {
    return /^\d{2}-\d{2}$/.test(text) && isValidDate(`2000-${text}`);
}

export function validateInput(input: RecordInput): string | null {
    if (!isPositiveInt(input.ownerId)) return '保有者を選んでください';
    if (input.ticker.trim() === '') return '銘柄コードを入力してください';
    if (parseShares(input.sharesText) === null) return '保有株数は1以上の整数で入力してください';
    if (input.payments.length === 0) return '受取日を1つ以上入力してください';
    if (input.payments.length > MAX_PAYMENTS) return `受取日は${MAX_PAYMENTS}件までです`;
    for (const payment of input.payments) {
        if (!isValidPayDate(payment.payDate)) return '受取日を正しく選んでください';
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

/** 記録の形を調べる。日付の形式（v0.4 は MM-DD、v0.3 は YYYY-MM-DD）だけ差し替えられる。 */
function isRecordShape(value: unknown, isDate: (text: string) => boolean): value is DividendRecord {
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

export function isValidRecord(value: unknown): value is DividendRecord {
    return isRecordShape(value, isValidPayDate);
}

/**
 * v0.3 形式（payDate が YYYY-MM-DD）の記録を v0.4 形式（MM-DD）に変換する。不正なら null。
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
    return { ...value, payments };
}

/** v0.2 形式（payDate を 1 つだけ持つ記録）を v0.4 形式に変換する。不正なら null。 */
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

/** 記録の 1 年分の受取額の合計と、保有者ごとの内訳。 */
export function annualTotals(records: DividendRecord[]): Breakdown {
    const byOwner = new Map<number, number>();
    for (const record of records) {
        byOwner.set(record.ownerId, (byOwner.get(record.ownerId) ?? 0) + recordTotal(record));
    }
    return toBreakdown(byOwner);
}

export function buildYearlyTotal(
    records: DividendRecord[],
    year: number,
    registeredBy: number,
    registeredAt: string,
): YearlyTotal {
    return { year, ...annualTotals(records), registeredBy, registeredAt };
}

function isValidYear(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= MIN_YEAR &&
        value <= MAX_YEAR
    );
}

export function isValidYearlyTotal(value: unknown): value is YearlyTotal {
    if (typeof value !== 'object' || value === null) return false;
    const t = value as Record<string, unknown>;
    const { owners } = t;
    if (!Array.isArray(owners)) return false;
    let sum = 0;
    let previous = 0;
    for (const item of owners as unknown[]) {
        if (typeof item !== 'object' || item === null) return false;
        const { ownerId, total } = item as Record<string, unknown>;
        if (!isPositiveInt(ownerId) || !isPositiveInt(total) || ownerId <= previous) return false;
        previous = ownerId;
        sum += total;
    }
    return (
        isValidYear(t['year']) &&
        t['total'] === sum &&
        isPositiveInt(t['registeredBy']) &&
        typeof t['registeredAt'] === 'string'
    );
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

/** 1〜12 月それぞれの受取額の合計（記録の 1 年分）と、保有者ごとの内訳。 */
export function monthlyTotals(records: DividendRecord[]): MonthlyTotal[] {
    const byOwner = Array.from({ length: 12 }, () => new Map<number, number>());
    for (const record of records) {
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
 * 年別グラフ用。endYear までの CHART_YEARS 年分を年の昇順で返す。登録の無い年は 0 円。
 * ownerId が null でなければ、その保有者の分だけにする。
 */
export function yearlyChart(
    totals: YearlyTotal[],
    endYear: number,
    ownerId: number | null,
): YearlyBar[] {
    return Array.from({ length: CHART_YEARS }, (_, i) => {
        const year = endYear - CHART_YEARS + 1 + i;
        const owners = (totals.find((t) => t.year === year)?.owners ?? [])
            .filter((o) => ownerId === null || o.ownerId === ownerId)
            .map((o) => ({ ...o }));
        return { year, total: owners.reduce((sum, o) => sum + o.total, 0), owners };
    });
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

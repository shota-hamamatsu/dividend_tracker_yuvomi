export interface DividendRecord {
    id: string;
    ownerId: number; // 株を保有している yuvomi ユーザーの id
    ticker: string;
    name: string;
    payDate: string; // YYYY-MM-DD
    shares: number; // 保有株数（1 以上の整数）
    perShareCents: number; // 1株当たり配当（1/100 円単位の整数）
    amount: number; // 受取額（円）= calcAmount(shares, perShareCents)
    createdBy: number;
    createdAt: string; // ISO 8601
}

export interface RecordInput {
    ownerId: number;
    ticker: string;
    name: string;
    payDate: string;
    sharesText: string;
    perShareText: string;
}

const MAX_SHARES = 10_000_000;
const MAX_PER_SHARE_CENTS = 10_000_000; // 100,000円

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
    if (!isValidDate(input.payDate)) return '受取日を入力してください';
    if (parseShares(input.sharesText) === null) return '保有株数は1以上の整数で入力してください';
    if (parsePerShare(input.perShareText) === null) {
        return '1株当たり配当は0以上、小数第2位までで入力してください';
    }
    return null;
}

export function isValidRecord(value: unknown): value is DividendRecord {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    const { shares, perShareCents } = r;
    return (
        typeof r['id'] === 'string' &&
        isPositiveInt(r['ownerId']) &&
        typeof r['ticker'] === 'string' &&
        r['ticker'] !== '' &&
        typeof r['name'] === 'string' &&
        typeof r['payDate'] === 'string' &&
        isValidDate(r['payDate']) &&
        isPositiveInt(shares) &&
        shares <= MAX_SHARES &&
        typeof perShareCents === 'number' &&
        Number.isInteger(perShareCents) &&
        perShareCents >= 0 &&
        perShareCents <= MAX_PER_SHARE_CENTS &&
        r['amount'] === calcAmount(shares, perShareCents) &&
        isPositiveInt(r['createdBy']) &&
        typeof r['createdAt'] === 'string'
    );
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

export function yearlyTotals(records: DividendRecord[]): { year: string; total: number }[] {
    const totals = new Map<string, number>();
    for (const record of records) {
        const year = record.payDate.substring(0, 4);
        totals.set(year, (totals.get(year) ?? 0) + record.amount);
    }
    return Array.from(totals, ([year, total]) => ({ year, total })).sort((a, b) =>
        a.year < b.year ? 1 : a.year > b.year ? -1 : 0,
    );
}

export function sortByPayDateDesc(records: DividendRecord[]): DividendRecord[] {
    return [...records].sort((a, b) =>
        a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0,
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

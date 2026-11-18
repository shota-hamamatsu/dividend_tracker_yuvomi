export interface DividendRecord {
    id: string;
    ticker: string;
    name: string;
    payDate: string; // YYYY-MM-DD
    amount: number; // 円。0 以上の整数
}

export function isValidRecord(value: unknown): value is DividendRecord {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    const requiredKeys = ['id', 'ticker', 'name', 'payDate'];
    for (const key of requiredKeys) {
        if (typeof obj[key] !== 'string') return false;
    }
    const amount = obj['amount'];
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return false;
    if ((obj['ticker'] as string).length === 0) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(obj['payDate'] as string);
}

export function parseRecords(json: string | null): DividendRecord[] {
    if (json === null) return [];
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValidRecord);
    } catch {
        return [];
    }
}

export function validateInput(input: {
    ticker: string;
    payDate: string;
    amountText: string;
}): string | null {
    if (input.ticker.trim().length === 0) return '銘柄コードを入力してください';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payDate)) return '受取日を入力してください';
    if (!/^\d+$/.test(input.amountText)) return '受取額は0以上の整数で入力してください';
    return null;
}

export function yearlyTotals(records: DividendRecord[]): { year: string; total: number }[] {
    const totals = new Map<string, number>();
    for (const record of records) {
        const year = record.payDate.substring(0, 4);
        const currentTotal = totals.get(year) || 0;
        totals.set(year, currentTotal + record.amount);
    }
    const result: { year: string; total: number }[] = Array.from(totals.entries()).map(
        ([year, total]) => ({ year, total }),
    );
    result.sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
    return result;
}

export function sortByPayDateDesc(records: DividendRecord[]): DividendRecord[] {
    return [...records].sort((a, b) =>
        a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0,
    );
}

export function formatYen(amount: number): string {
    return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

export function newId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    {
        const now = Date.now();
        const randomPart = Math.floor(Math.random() * 1000000).toString(16);
        return `${now}-${randomPart}`;
    }
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    type DividendRecord,
    type YearlyTotal,
    isValidRecord,
    isValidYearlyTotal,
    migrateLegacyRecord,
    migrateV3Record,
} from '../src/logic.ts';

export interface Store {
    list(): DividendRecord[];
    get(id: string): DividendRecord | undefined;
    add(record: DividendRecord): Promise<void>;
    /** 同じ id の記録を置き換える。無ければ false。 */
    update(record: DividendRecord): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    /** 登録済みの年別合計（年の昇順）。 */
    listYearlyTotals(): YearlyTotal[];
    /** 同じ年を置き換える。無ければ追加する。 */
    putYearlyTotal(total: YearlyTotal): Promise<void>;
}

interface Data {
    records: DividendRecord[];
    yearlyTotals: YearlyTotal[];
}

const FILE_VERSION = 3;

function withYearlyTotal(totals: YearlyTotal[], total: YearlyTotal): YearlyTotal[] {
    return [...totals.filter((t) => t.year !== total.year), total].sort((a, b) => a.year - b.year);
}

function validOnly<T>(list: unknown[], convert: (value: unknown) => T | null): T[] {
    return list.map(convert).filter((r): r is T => r !== null);
}

/** 保存ファイルの中身を取り出す。version 1（v0.2 形式）・2（v0.3 形式）は移行する。 */
function loadData(parsed: unknown): Data {
    const { version, records, yearlyTotals } = (parsed ?? {}) as {
        version?: unknown;
        records?: unknown;
        yearlyTotals?: unknown;
    };
    const list = Array.isArray(records) ? (records as unknown[]) : [];
    if (version === FILE_VERSION) {
        let totals: YearlyTotal[] = [];
        if (Array.isArray(yearlyTotals)) {
            // 同じ年が複数あれば後のもの
            for (const t of (yearlyTotals as unknown[]).filter(isValidYearlyTotal)) {
                totals = withYearlyTotal(totals, t);
            }
        }
        return { records: list.filter(isValidRecord), yearlyTotals: totals };
    }
    if (version === 2) return { records: validOnly(list, migrateV3Record), yearlyTotals: [] };
    if (version === 1) return { records: validOnly(list, migrateLegacyRecord), yearlyTotals: [] };
    throw new Error(`records.json の version ${String(version)} には対応していません`);
}

/** メモリ上の値を正とし、変更のたびに JSON ファイルへ書き出す。 */
export async function openFileStore(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'records.json');
    await mkdir(dataDir, { recursive: true });

    let data: Data = { records: [], yearlyTotals: [] };
    try {
        data = loadData(JSON.parse(await readFile(file, 'utf8')));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // 書き込みを直列化する（前の書き込みの成否に関わらず次へ進む）
    let queue: Promise<void> = Promise.resolve();
    const persist = (snapshot: Data): Promise<void> => {
        const run = queue.then(async () => {
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify({ version: FILE_VERSION, ...snapshot }), 'utf8');
            await rename(tmp, file);
        });
        queue = run.catch(() => undefined);
        return run;
    };

    /** 変更を反映して書き出す。失敗したら元に戻す。 */
    const commit = async (next: Data): Promise<void> => {
        const before = data;
        data = next;
        try {
            await persist(data);
        } catch (err) {
            data = before;
            throw err;
        }
    };

    return {
        list: () => [...data.records],
        get: (id) => data.records.find((r) => r.id === id),
        async add(record) {
            await commit({ ...data, records: [...data.records, record] });
        },
        async update(record) {
            const index = data.records.findIndex((r) => r.id === record.id);
            if (index < 0) return false;
            const records = data.records.map((r, i) => (i === index ? record : r));
            await commit({ ...data, records });
            return true;
        },
        async remove(id) {
            const records = data.records.filter((r) => r.id !== id);
            if (records.length === data.records.length) return false;
            await commit({ ...data, records });
            return true;
        },
        listYearlyTotals: () => [...data.yearlyTotals],
        async putYearlyTotal(total) {
            await commit({ ...data, yearlyTotals: withYearlyTotal(data.yearlyTotals, total) });
        },
    };
}

/** テスト用。ファイルに書かない。 */
export function memoryStore(
    initial: DividendRecord[] = [],
    initialTotals: YearlyTotal[] = [],
): Store {
    let records = [...initial];
    let yearlyTotals = [...initialTotals];
    return {
        list: () => [...records],
        get: (id) => records.find((r) => r.id === id),
        async add(record) {
            records = [...records, record];
        },
        async update(record) {
            const index = records.findIndex((r) => r.id === record.id);
            if (index < 0) return false;
            records = records.map((r, i) => (i === index ? record : r));
            return true;
        },
        async remove(id) {
            const next = records.filter((r) => r.id !== id);
            const removed = next.length !== records.length;
            records = next;
            return removed;
        },
        listYearlyTotals: () => [...yearlyTotals],
        async putYearlyTotal(total) {
            yearlyTotals = withYearlyTotal(yearlyTotals, total);
        },
    };
}

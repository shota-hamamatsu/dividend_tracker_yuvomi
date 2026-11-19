import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    type DividendRecord,
    type YearlyTotal,
    isValidRecord,
    isValidYearlyTotal,
    migrateLegacyRecord,
    migrateV3Record,
    migrateV4Record,
    migrateV4YearlyTotal,
} from '../src/logic.ts';

export interface Store {
    list(): DividendRecord[];
    get(id: string): DividendRecord | undefined;
    add(record: DividendRecord): Promise<void>;
    /** Replaces the record with the same id. False when there is none. */
    update(record: DividendRecord): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    /** Registered yearly totals (ascending by year). */
    listYearlyTotals(): YearlyTotal[];
    /** Replaces the same year, or adds it. */
    putYearlyTotal(total: YearlyTotal): Promise<void>;
}

interface Data {
    records: DividendRecord[];
    yearlyTotals: YearlyTotal[];
}

const FILE_VERSION = 4;

function withYearlyTotal(totals: YearlyTotal[], total: YearlyTotal): YearlyTotal[] {
    return [...totals.filter((t) => t.year !== total.year), total].sort((a, b) => a.year - b.year);
}

function validOnly<T>(list: unknown[], convert: (value: unknown) => T | null): T[] {
    return list.map(convert).filter((r): r is T => r !== null);
}

/** Converts yearly totals, keeping the last one when a year appears more than once. */
function loadYearlyTotals(
    value: unknown,
    convert: (v: unknown) => YearlyTotal | null,
): YearlyTotal[] {
    let totals: YearlyTotal[] = [];
    if (!Array.isArray(value)) return totals;
    for (const t of validOnly(value as unknown[], convert)) {
        totals = withYearlyTotal(totals, t);
    }
    return totals;
}

/**
 * Reads the stored file.
 * Versions 1 (v0.2), 2 (v0.3) and 3 (v0.4) are migrated.
 */
function loadData(parsed: unknown): Data {
    const { version, records, yearlyTotals } = (parsed ?? {}) as {
        version?: unknown;
        records?: unknown;
        yearlyTotals?: unknown;
    };
    const list = Array.isArray(records) ? (records as unknown[]) : [];
    if (version === FILE_VERSION) {
        return {
            records: list.filter(isValidRecord),
            yearlyTotals: loadYearlyTotals(yearlyTotals, (t) => (isValidYearlyTotal(t) ? t : null)),
        };
    }
    if (version === 3) {
        return {
            records: validOnly(list, migrateV4Record),
            yearlyTotals: loadYearlyTotals(yearlyTotals, migrateV4YearlyTotal),
        };
    }
    if (version === 2) return { records: validOnly(list, migrateV3Record), yearlyTotals: [] };
    if (version === 1) return { records: validOnly(list, migrateLegacyRecord), yearlyTotals: [] };
    throw new Error(`records.json version ${String(version)} is not supported`);
}

/** The in-memory data is the source of truth; every change is written to the JSON file. */
export async function openFileStore(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'records.json');
    await mkdir(dataDir, { recursive: true });

    let data: Data = { records: [], yearlyTotals: [] };
    try {
        data = loadData(JSON.parse(await readFile(file, 'utf8')));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // Serialize writes (the next one runs whether or not the previous one succeeded)
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

    /** Applies and writes a change, rolling back on failure. */
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

/** For tests. Never writes a file. */
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

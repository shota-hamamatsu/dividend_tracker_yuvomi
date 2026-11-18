import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DividendRecord, isValidRecord, migrateLegacyRecord } from '../src/logic.ts';

export interface Store {
    list(): DividendRecord[];
    get(id: string): DividendRecord | undefined;
    add(record: DividendRecord): Promise<void>;
    /** 同じ id の記録を置き換える。無ければ false。 */
    update(record: DividendRecord): Promise<boolean>;
    remove(id: string): Promise<boolean>;
}

const FILE_VERSION = 2;

/** 保存ファイルの中身から記録を取り出す。version 1（v0.2 形式）は移行する。 */
function loadRecords(parsed: unknown): DividendRecord[] {
    const { version, records } = (parsed ?? {}) as { version?: unknown; records?: unknown };
    if (version === FILE_VERSION)
        return Array.isArray(records) ? records.filter(isValidRecord) : [];
    if (version === 1) {
        if (!Array.isArray(records)) return [];
        return records.map(migrateLegacyRecord).filter((r): r is DividendRecord => r !== null);
    }
    throw new Error(`records.json の version ${String(version)} には対応していません`);
}

/** メモリ上の配列を正とし、変更のたびに JSON ファイルへ書き出す。 */
export async function openFileStore(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'records.json');
    await mkdir(dataDir, { recursive: true });

    let records: DividendRecord[] = [];
    try {
        records = loadRecords(JSON.parse(await readFile(file, 'utf8')));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // 書き込みを直列化する（前の書き込みの成否に関わらず次へ進む）
    let queue: Promise<void> = Promise.resolve();
    const persist = (snapshot: DividendRecord[]): Promise<void> => {
        const run = queue.then(async () => {
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(
                tmp,
                JSON.stringify({ version: FILE_VERSION, records: snapshot }),
                'utf8',
            );
            await rename(tmp, file);
        });
        queue = run.catch(() => undefined);
        return run;
    };

    return {
        list: () => [...records],
        get: (id) => records.find((r) => r.id === id),
        async add(record) {
            const before = records;
            records = [...records, record];
            try {
                await persist(records);
            } catch (err) {
                records = before;
                throw err;
            }
        },
        async update(record) {
            const index = records.findIndex((r) => r.id === record.id);
            if (index < 0) return false;
            const before = records;
            records = records.map((r, i) => (i === index ? record : r));
            try {
                await persist(records);
            } catch (err) {
                records = before;
                throw err;
            }
            return true;
        },
        async remove(id) {
            const before = records;
            const next = records.filter((r) => r.id !== id);
            if (next.length === records.length) return false;
            records = next;
            try {
                await persist(records);
            } catch (err) {
                records = before;
                throw err;
            }
            return true;
        },
    };
}

/** テスト用。ファイルに書かない。 */
export function memoryStore(initial: DividendRecord[] = []): Store {
    let records = [...initial];
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
    };
}

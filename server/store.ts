import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DividendRecord, isValidRecord } from '../src/logic.ts';

export interface Store {
    list(): DividendRecord[];
    get(id: string): DividendRecord | undefined;
    add(record: DividendRecord): Promise<void>;
    remove(id: string): Promise<boolean>;
}

/** メモリ上の配列を正とし、変更のたびに JSON ファイルへ書き出す。 */
export async function openFileStore(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'records.json');
    await mkdir(dataDir, { recursive: true });

    let records: DividendRecord[] = [];
    try {
        const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
        const list = (parsed as { records?: unknown })?.records;
        if (Array.isArray(list)) records = list.filter(isValidRecord);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // 書き込みを直列化する（前の書き込みの成否に関わらず次へ進む）
    let queue: Promise<void> = Promise.resolve();
    const persist = (snapshot: DividendRecord[]): Promise<void> => {
        const run = queue.then(async () => {
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify({ version: 1, records: snapshot }), 'utf8');
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
        async remove(id) {
            const next = records.filter((r) => r.id !== id);
            const removed = next.length !== records.length;
            records = next;
            return removed;
        },
    };
}

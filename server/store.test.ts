import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFileStore } from './store.ts';
import type { DividendRecord } from '../src/logic.ts';

const record: DividendRecord = {
    id: 'a',
    ownerId: 1,
    ticker: '7203',
    name: '',
    payDate: '2025-03-31',
    shares: 100,
    perShareCents: 4500,
    amount: 4500,
    createdBy: 1,
    createdAt: '2025-04-01T00:00:00.000Z',
};

test('file store persists, reloads and drops invalid rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dt-store-'));
    try {
        const store = await openFileStore(dir);
        assert.deepEqual(store.list(), []);
        await Promise.all([store.add(record), store.add({ ...record, id: 'b' })]);
        assert.equal(await store.remove('b'), true);
        assert.equal(await store.remove('missing'), false);

        const reopened = await openFileStore(dir);
        assert.deepEqual(reopened.list(), [record]);

        const file = join(dir, 'records.json');
        const saved = JSON.parse(await readFile(file, 'utf8'));
        saved.records.push({ ...record, id: 'bad', amount: 1 });
        await writeFile(file, JSON.stringify(saved));
        assert.deepEqual((await openFileStore(dir)).list(), [record]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

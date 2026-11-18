import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFileStore } from './store.ts';
import type { DividendRecord, YearlyTotal } from '../src/logic.ts';

const record: DividendRecord = {
    id: 'a',
    ownerId: 1,
    ticker: '7203',
    name: '',
    shares: 100,
    payments: [{ payDate: '03-31', perShareCents: 4500, amount: 4500 }],
    createdBy: 1,
    createdAt: '2025-04-01T00:00:00.000Z',
    updatedAt: '2025-04-01T00:00:00.000Z',
};

const total2025: YearlyTotal = {
    year: 2025,
    total: 4500,
    owners: [{ ownerId: 1, total: 4500 }],
    registeredBy: 1,
    registeredAt: '2025-12-31T00:00:00.000Z',
};

test('file store persists, reloads and drops invalid rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dt-store-'));
    try {
        const store = await openFileStore(dir);
        assert.deepEqual(store.list(), []);
        await Promise.all([store.add(record), store.add({ ...record, id: 'b' })]);
        assert.equal(await store.remove('b'), true);
        assert.equal(await store.remove('missing'), false);
        const edited = { ...record, name: 'トヨタ', updatedAt: '2025-05-01T00:00:00.000Z' };
        assert.equal(await store.update(edited), true);
        assert.equal(await store.update({ ...record, id: 'missing' }), false);
        assert.deepEqual(store.list(), [edited]);
        assert.equal(await store.update(record), true);

        await store.putYearlyTotal({ ...total2025, year: 2026 });
        await store.putYearlyTotal({ ...total2025, total: 1, owners: [{ ownerId: 1, total: 1 }] });
        await store.putYearlyTotal(total2025); // 同じ年は置き換える
        assert.deepEqual(
            store.listYearlyTotals().map((t) => [t.year, t.total]),
            [
                [2025, 4500],
                [2026, 4500],
            ],
        );

        const reopened = await openFileStore(dir);
        assert.deepEqual(reopened.list(), [record]);
        assert.deepEqual(reopened.listYearlyTotals(), [total2025, { ...total2025, year: 2026 }]);

        const file = join(dir, 'records.json');
        const saved = JSON.parse(await readFile(file, 'utf8'));
        saved.records.push({
            ...record,
            id: 'bad',
            payments: [{ payDate: '03-31', perShareCents: 4500, amount: 1 }],
        });
        saved.yearlyTotals.push({ ...total2025, year: 2030, total: 1 });
        await writeFile(file, JSON.stringify(saved));
        const third = await openFileStore(dir);
        assert.deepEqual(third.list(), [record]);
        assert.deepEqual(
            third.listYearlyTotals().map((t) => t.year),
            [2025, 2026],
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('file store migrates version 2 files to month-day pay dates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dt-store-'));
    try {
        const file = join(dir, 'records.json');
        const v3 = {
            ...record,
            payments: [
                { payDate: '2024-03-29', perShareCents: 4000, amount: 4000 },
                { payDate: '2025-03-29', perShareCents: 4500, amount: 4500 },
                { payDate: '2025-09-30', perShareCents: 4500, amount: 4500 },
            ],
        };
        await writeFile(
            file,
            JSON.stringify({ version: 2, records: [v3, { ...v3, id: 'bad', payments: [] }] }),
        );
        const store = await openFileStore(dir);
        assert.deepEqual(store.list(), [
            {
                ...record,
                payments: [
                    { payDate: '03-29', perShareCents: 4500, amount: 4500 },
                    { payDate: '09-30', perShareCents: 4500, amount: 4500 },
                ],
            },
        ]);
        await store.putYearlyTotal(total2025);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(saved.version, 3);
        assert.equal(saved.records[0].payments[0].payDate, '03-29');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('file store migrates version 1 files and rejects unknown versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dt-store-'));
    try {
        const file = join(dir, 'records.json');
        const legacy = {
            id: 'old',
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
        await writeFile(
            file,
            JSON.stringify({ version: 1, records: [legacy, { ...legacy, id: 'bad', amount: 1 }] }),
        );
        const store = await openFileStore(dir);
        assert.deepEqual(store.list(), [{ ...record, id: 'old' }]);
        assert.deepEqual(store.listYearlyTotals(), []);

        // 書き込むと version 3 になる
        await store.add({ ...record, id: 'new' });
        const saved = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(saved.version, 3);
        assert.deepEqual(saved.yearlyTotals, []);
        assert.deepEqual(
            (await openFileStore(dir)).list().map((r) => r.id),
            ['old', 'new'],
        );

        await writeFile(file, JSON.stringify({ version: 4, records: [] }));
        await assert.rejects(openFileStore(dir));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

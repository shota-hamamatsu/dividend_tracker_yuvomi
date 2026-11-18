import { createServer } from 'node:http';
import { createHandler } from './app.ts';
import { openFileStore } from './store.ts';
import { yuvomiClient } from './yuvomi.ts';

const port = Number(process.env['PORT'] ?? 8080);
const internalUrl = process.env['YUVOMI_INTERNAL_URL'] ?? 'http://yuvomi:3000';
const publicOrigin = (process.env['PUBLIC_ORIGIN'] ?? '').replace(/\/+$/, '');
const dataDir = process.env['DATA_DIR'] ?? '/data';

if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) {
    console.error('PUBLIC_ORIGIN を設定してください（例: https://yuvomi.example.com）');
    process.exit(1);
}

const store = await openFileStore(dataDir);
const client = yuvomiClient(internalUrl);
const handler = createHandler({
    getMe: client.getMe,
    getMemberIds: client.getMemberIds,
    store,
    publicOrigin,
});

createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.log(`dividend-tracker sidecar listening on :${port}`);
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 画面確認用の開発サーバー。yuvomi 本体の /api.js を偽物に差し替える。
export default defineConfig({
    publicDir: false,
    resolve: {
        alias: [
            {
                find: /^\/api\.js$/,
                replacement: fileURLToPath(new URL('./dev/mock-api.ts', import.meta.url)),
            },
        ],
    },
    server: { open: '/dev/' },
});

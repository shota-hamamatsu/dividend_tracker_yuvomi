import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Dev server for the preview page. Replaces yuvomi's /api.js and /i18n.js with mocks.
export default defineConfig({
    publicDir: false,
    resolve: {
        alias: [
            {
                find: /^\/api\.js$/,
                replacement: fileURLToPath(new URL('./dev/mock-api.ts', import.meta.url)),
            },
            {
                find: /^\/i18n\.js$/,
                replacement: fileURLToPath(new URL('./dev/mock-i18n.ts', import.meta.url)),
            },
        ],
    },
    server: { open: '/dev/' },
});

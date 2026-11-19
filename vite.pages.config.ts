import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import devConfig from './vite.dev.config.ts';

// Builds the preview page (dev/) as static files for GitHub Pages.
// The /api.js and /i18n.js mocks come from the dev config.
export default mergeConfig(devConfig, {
    base: '/dividend_tracker_yuvomi/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: fileURLToPath(new URL('./dev/index.html', import.meta.url)),
        },
    },
});

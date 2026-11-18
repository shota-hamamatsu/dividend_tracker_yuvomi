import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import devConfig from './vite.dev.config.ts';

// 画面確認ページ（dev/）を GitHub Pages 用の静的ファイルにビルドする。
// /api.js の差し替えは開発用の設定をそのまま使う。
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

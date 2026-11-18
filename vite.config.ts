import { defineConfig } from 'vite';

// src/index.ts を 1 ファイルの ES モジュールにして modules/dividend-tracker/index.js へ出力する。
// module.json / style.css は同じフォルダに手書きで置くため、出力先を空にしない。
export default defineConfig({
    publicDir: false,
    build: {
        outDir: 'modules/dividend-tracker',
        emptyOutDir: false,
        minify: false,
        target: 'es2022',
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            // yuvomi が提供する安定した import 先のみ。バンドルに含めない。
            external: ['/api.js', '/i18n.js', '/utils/html.js'],
        },
    },
});

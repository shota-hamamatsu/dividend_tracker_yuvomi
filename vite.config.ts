import { defineConfig } from 'vite';

// Builds src/index.ts into one ES module at modules/dividend-tracker/index.js.
// module.json and style.css live in the same folder, so the output folder is not emptied.
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
            // The stable imports yuvomi provides. They are not bundled.
            external: ['/api.js', '/i18n.js', '/utils/html.js'],
        },
    },
});

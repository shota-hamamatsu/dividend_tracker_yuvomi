// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        // Build output is not linted
        ignores: ['modules/**', 'dist/**', 'node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    // Prettier handles formatting, so ESLint's formatting rules are turned off
    eslintConfigPrettier,
);

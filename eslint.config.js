// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        // 生成物（ビルド出力）は lint 対象外
        ignores: ['modules/**', 'dist/**', 'node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    // 整形は Prettier に任せるため、ESLint 側の整形系ルールを無効化する
    eslintConfigPrettier,
);

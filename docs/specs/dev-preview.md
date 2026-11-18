# 仕様: 画面確認用の開発ページ（dev/）v0.3

`src/index.ts` を yuvomi 本体なしでブラウザ表示し、見た目と挙動を確認するための開発専用ページ。
本番の成果物（`modules/`、`server/`）には含めない。`npm run dev` で起動する（Vite 開発サーバー）。
TypeScript（strict）。`enum` / `namespace` / デコレータは使わない。`innerHTML` / `outerHTML` という語は書かない。

## 対象ファイル

| ファイル               | 役割                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `vite.dev.config.ts`   | 開発サーバー設定。`/api.js` を `dev/mock-api.ts` に差し替え、`/dev/` を開く |
| `dev/index.html`       | 確認用ページ。`/modules/dividend-tracker/style.css` と `dev/tokens.css` を読む |
| `dev/tokens.css`       | yuvomi のデザイントークンの近似値（ライト／ダーク）                         |
| `dev/mock-api.ts`      | `export const api = { get }`。`/family/members` に偽の家族一覧を返す        |
| `dev/mock-records.ts`  | `fetch` の偽物と、シナリオ定義                                              |
| `dev/main.ts`          | シナリオ切り替え UI と `render` の呼び出し                                  |
| `package.json`         | `"dev": "vite --config vite.dev.config.ts"` を追加                          |
| `tsconfig.json`        | `include` に `dev` と `vite.dev.config.ts` を追加                           |

## シナリオ

`?scenario=<名前>`（既定 `admin`）で決まる。ページ上部の `select` で切り替えると URL を更新して再描画する。

| 名前       | 内容                                                                 |
| ---------- | -------------------------------------------------------------------- |
| `admin`    | 管理者（id=1, canWrite）。記録が数件ある                             |
| `member`   | 一般ユーザー（id=2, canWrite）。記録が数件ある                       |
| `viewer`   | 閲覧のみ（id=2, canWrite=false）                                     |
| `empty`    | 管理者。記録 0 件                                                    |
| `error`    | 記録の取得が 500 を返す（「データを読み込めませんでした」の確認用）  |
| `slow`     | 記録の取得に 2 秒かかる（「読み込み中…」の確認用）                   |

家族一覧は常に `[{id:1, display_name:'太郎'}, {id:2, display_name:'花子'}, {id:3, display_name:'次郎'}]`。

## 偽の記録 API（`dev/mock-records.ts`）

- `installMockFetch(scenario)`: `window.fetch` を差し替える。URL が `/api/extensions/dividend-tracker/records` で始まるものだけ処理し、それ以外は元の `fetch` へ渡す。
- GET: `200 { data: records, me: { id, isAdmin, canWrite }, csrfToken: 'dev-token' }`。`error` は `500 { error: '開発用: 取得エラー' }`、`slow` は 2 秒待ってから通常応答。
- POST: ヘッダー `X-DT-CSRF` が `dev-token` でなければ `403 { error: '画面を再読み込みしてから、もう一度お試しください' }`。`me.canWrite` が false なら `403 { error: '書き込み権限がありません' }`。
  一般ユーザーで `ownerId` が自分以外なら `403 { error: '自分の記録だけ追加できます' }`。
  OK なら、本文に `id`（連番の文字列）を付けた記録を保存して `201 { data: record }`。保存先はメモリ上の配列のみ（再描画・再読み込みで初期データに戻る）。
  本文（v0.3 の `RecordInput`）は `validateInput` で検証し、エラーなら `400 { error }`。受取額は `buildPayments` で計算する。
- PUT `/records/<id>`（v0.2 で追加）: POST と同じ検証のあと、該当なしは `404 { error: '記録が見つかりません' }`、一般ユーザーが他人の記録なら `403`。OK なら `id`・`createdBy`・`createdAt` を残して置き換え、`200 { data: record }`。
- DELETE `/records/<id>`（v0.3 で追加）: CSRF・`canWrite` の確認は POST と同じ。該当なしは `404 { error: '記録が見つかりません' }`、一般ユーザーが他人の記録なら `403 { error: '自分の記録だけ削除できます' }`。OK なら配列から除いて `200 { data: { id, deleted: true } }`。
- 記録の形は `src/logic.ts` の `DividendRecord` に従う（`import type`）。初期データは 2024 年と 2025 年にまたがる 4 件程度（受取日を複数持つ記録を含む）、保有者は 1〜3 に散らす。
- `AbortSignal` が中断済みなら `DOMException('Aborted', 'AbortError')` で reject する。

## 確認用ページ（`dev/main.ts`）

- `dev/index.html` に `<header id="dev-bar">`（シナリオ選択とテーマ切り替え）と `<main id="app">` を置く。
- テーマ切り替えは `select`（`ライト` / `ダーク`）。`document.documentElement.dataset['theme']` に `light` / `dark` を入れる。`dev/tokens.css` は `:root` をライト、`:root[data-theme='dark']` をダークの値にする。
- `#app` に対し、前回の `AbortController` を `abort()` してから新しい `AbortController` で `render(#app, { signal })` を呼ぶ。`installMockFetch` はシナリオ変更のたびに呼び直す（元の `fetch` は 1 度だけ保存して使い回す）。
- `src/index.ts` は直接 import する（`../src/index.ts`）。

## `dev/tokens.css`

`modules/dividend-tracker/style.css` が使うトークンだけを定義する: `--space-1`〜`--space-6`、`--color-text-primary`、`--color-text-secondary`、`--color-btn-primary`、`--color-text-on-accent`、`--color-danger-ink`、`--target-base`、`--type-caption`、`--text-lg`、`--radius-full`、`--font-weight-medium`、`--color-bg`（`body` の背景）。
値は yuvomi の近似でよい（ファイル先頭に「近似値。本物は yuvomi の tokens.css」と書く）。あわせて `.page-toolbar` / `.page-toolbar__title` / `.page-section` / `.app-page__body` に最低限の余白と見出しサイズを与える（ホスト側 CSS の代わり）。

## 禁止事項

- `src/`・`modules/`・`server/` を変更しない。
- 仕様にない機能（永続化、ログイン等）を足さない。
- 外部 URL・外部ライブラリを使わない（Vite のみ）。

## 受け入れ条件

- `npm run dev` で起動し、`http://localhost:5173/dev/` が開く。
- 6 つのシナリオが切り替えられ、追加フォームの送信で年間配当合計が更新される。
- `npm run lint` / `format:check` / `typecheck` / `test` / `build` が通る（`build` の出力 `modules/dividend-tracker/index.js` は変わらない）。

## 出力形式

指定された 1 ファイルの内容のみ。

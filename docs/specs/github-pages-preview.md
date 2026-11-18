# 仕様: 画面確認ページの GitHub Pages 公開 v0.1

`npm run dev` で見られる画面確認ページ（`docs/specs/dev-preview.md` v0.3）を、静的ファイルにビルドして GitHub Pages で公開する。
偽の家族一覧（`dev/mock-api.ts`）と偽の記録 API（`dev/mock-records.ts`）はブラウザ内で動くため、サーバーは要らない。
本番の成果物（`modules/`、`server/`）と、その出力（`npm run build` → `modules/dividend-tracker/index.js`）は変えない。

## 公開先

- `https://shota-hamamatsu.github.io/dividend_tracker_yuvomi/dev/`（確認用ページ本体）
- `https://shota-hamamatsu.github.io/dividend_tracker_yuvomi/` はページ本体の `dev/` へ転送する。
- シナリオは開発時と同じく `?scenario=<名前>` で切り替えられる。

## 対象ファイル

| ファイル                       | 変更                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `vite.pages.config.ts`         | 新規。Pages 用のビルド設定                                            |
| `package.json`                 | `"build:pages": "vite build --config vite.pages.config.ts"` を追加     |
| `tsconfig.json`                | `include` に `vite.pages.config.ts` を追加                            |
| `.github/workflows/pages.yml`  | 新規。main への push でビルドして Pages にデプロイする                 |
| `README.md`                    | コマンド一覧に `npm run build:pages` と公開先 URL を 1 行ずつ追加      |

`dev/`・`src/`・`modules/`・`server/` は変更しない。

## `vite.pages.config.ts`

- `vite.dev.config.ts` の設定を `import` し、Vite の `mergeConfig` で次を上書きする（`/api.js` → `dev/mock-api.ts` の差し替えは開発用と共通にし、二重に書かない）。
  - `base: '/dividend_tracker_yuvomi/'`
  - `build.outDir: 'dist'`、`build.emptyOutDir: true`
  - `build.rollupOptions.input`: `dev/index.html`（ファイルパスは `fileURLToPath(new URL(..., import.meta.url))` で作る）
- `dev/index.html` の絶対パス（`/dev/tokens.css`、`/modules/dividend-tracker/style.css`、`/dev/main.ts`）は Vite が `base` 付きに書き換えるので、HTML 側は変えない。
- 出力は `dist/dev/index.html` と `dist/assets/` 配下になる。`dist/` は `.gitignore` 済み。
- `server.open` など開発サーバー用の設定が残っていてもビルドには影響しないので、消さなくてよい。

## `.github/workflows/pages.yml`

- 名前 `Deploy dev preview to Pages`。
- トリガー: `main` への `push` と `workflow_dispatch`。
- `permissions`: `contents: read`、`pages: write`、`id-token: write`。
- `concurrency`: `group: pages`、`cancel-in-progress: false`。
- ジョブ `build`（`ubuntu-latest`）:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4`（`node-version: 22`、`cache: npm`）
  3. `npm ci`
  4. `npm run build:pages`
  5. ルートの転送ページを書く: `dist/index.html` に、`dev/` へ移動する最小の HTML（`<meta http-equiv="refresh" content="0; url=dev/">` と、同じ先への `a` リンク）。`run` のヒアドキュメントで書く。
  6. `actions/configure-pages@v5`
  7. `actions/upload-pages-artifact@v3`（`path: dist`）
- ジョブ `deploy`（`needs: build`、`environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`）:
  1. `actions/deploy-pages@v4`（`id: deployment`）
- シークレット・トークンは使わない（`GITHUB_TOKEN` の既定の権限のみ）。

## 公開されるデータ

- 公開されるのは `dev/mock-api.ts` と `dev/mock-records.ts` の **ダミーデータのみ**（家族名「太郎」「花子」「次郎」と架空の銘柄・配当）。実在の保有データ・個人データ・API キーは含めない。
- 画面上の追加・編集・削除はメモリ上の配列にだけ反映され、再読み込みで初期データに戻る（`dev-preview.md` のとおり）。外部への送信は無い。

## 手作業の設定（リポジトリ所有者が行う）

- GitHub のリポジトリ設定 → Pages → Build and deployment → Source を **GitHub Actions** にする。

## 禁止事項

- 仕様にない機能（独自ドメイン、アクセス解析、外部スクリプト、PR ごとのプレビュー等）を足さない。
- ワークフローに lint / test などデプロイ以外の工程を足さない（別の仕様で扱う）。
- `dev/` の偽データに実データを入れない。

## 受け入れ条件

- `npm run build:pages` が通り、`dist/dev/index.html` が出力される。HTML 内の CSS・JS の参照が `/dividend_tracker_yuvomi/` で始まる。
- `dist/` を `/dividend_tracker_yuvomi/` 配下で配信すると（例: `npx vite preview --config vite.pages.config.ts`）、`/dividend_tracker_yuvomi/dev/` で 6 つのシナリオが開発時と同じように動く。コンソールにエラーが出ない。
- `npm run build` の出力 `modules/dividend-tracker/index.js` が変わらない。
- `npm run lint` / `format:check` / `typecheck` / `test` が通る。
- main に push するとワークフローが成功し、公開先 URL でページが表示される（Pages の設定後）。

## 出力形式

指定された 1 ファイルの内容のみ。

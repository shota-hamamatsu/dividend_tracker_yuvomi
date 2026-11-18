# dividend_tracker_yuvomi

[yuvomi.cloud](https://github.com/ulsklyc/yuvomi) の拡張機能（モジュール）として、配当（分配金）の管理を行うプロジェクトです。

## 目的

- 保有銘柄ごとの配当の記録・管理
- 受取予定・受取済みの配当の把握
- 年間・月間の配当収入の集計

## 現状（v0.3.0）

家族で共有できる配当台帳です。

- 銘柄ごとの記録（保有者・銘柄コード・銘柄名・保有株数）に、**受取日を複数**（最大 24 件）登録できます。受取日ごとに 1株当たり配当を設定します
- 受取額は受取日ごとに「保有株数 × 1株当たり配当」をサーバーで計算します（1株配当は小数第2位まで、**1円未満切り捨て**）
- 画面の一番上に年間配当合計、その下に銘柄一覧、一番下に月別配当額の棒グラフ。保有者でフィルタできます
- 追加は「追加」ボタン、編集は銘柄一覧の行クリックで開くダイアログで行います
- データはサイドカーサービスに保存し、家族全員が閲覧できます
- 追加・編集できるのは**自分が保有者の記録だけ**です。管理者は全員分を追加・編集できます
- yuvomi の「役割と権限」で `配当管理` を「閲覧のみ」にしたユーザーは閲覧だけ、「なし」にしたユーザーは使えません
- 表示言語は日本語のみです

v0.1.0 でブラウザ（localStorage）に保存していたデータは引き継がれません。
v0.2.0 のサイドカーのデータ（`records.json` の version 1）は、起動時に受取日 1 件の記録として読み込まれ、次の保存で version 2 に書き換わります。

## 構成

TypeScript で書き、画面は yuvomi が読み込める 1 ファイルの JS にビルドします。
yuvomi のモジュールはブラウザだけで動くため、サーバー保存には yuvomi の横で動く別サービス（サイドカー）を使います（yuvomi の [MODULES.md](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md)「Modules With A Backend Service」の方式）。

| 場所 | 内容 |
| --- | --- |
| `src/logic.ts` | 金額計算・検証・整形（画面とサイドカーで共通の純粋関数） |
| `src/index.ts` | 画面（`render(container, context)`） |
| `server/` | サイドカー（Node.js、npm 依存なし）。`/api/extensions/dividend-tracker/` で動く |
| `modules/dividend-tracker/` | yuvomi に取り込まれるモジュール（`module.json`、`style.css`、ビルド済み `index.js`） |
| `deploy/` | Docker Compose と Caddy の設定例 |
| `docs/specs/` | 実装仕様書 |

`modules/dividend-tracker/index.js` はビルド生成物ですが、GitHub の URL からインストールする際にビルドが走らないため、**リポジトリにコミットします**。ソースを変更したら必ず `npm run build` してください。

## 開発

Node.js 22.12 以上が必要です。

```bash
npm install
npm run dev         # 画面確認用ページ（http://localhost:5173/dev/。yuvomi・サイドカー不要。仕様: docs/specs/dev-preview.md）
npm run lint        # ESLint
npm run format:check # Prettier（整形は npm run format）
npm run typecheck   # 型チェック
npm test            # ロジックとサイドカーのテスト
npm run build       # modules/dividend-tracker/index.js を生成
npm run build:pages # 画面確認ページを dist/ に静的ビルド（GitHub Pages 用。仕様: docs/specs/github-pages-preview.md）
```

画面確認ページは main への push で GitHub Pages に公開されます: https://shota-hamamatsu.github.io/dividend_tracker_yuvomi/dev/

## yuvomi への導入

画面（モジュール）とサイドカーの両方が必要です。

### 1. サイドカーを動かす

`deploy/docker-compose.example.yml` と `deploy/Caddyfile.example` を参考に、yuvomi と同じオリジンで `/api/extensions/dividend-tracker/` をサイドカーへ転送します。**パスは書き換えずに**転送してください。

```bash
docker build -f server/Dockerfile -t dividend-tracker-sidecar .
```

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | （必須） | ブラウザで開く yuvomi の URL（例 `https://yuvomi.example.com`） |
| `YUVOMI_INTERNAL_URL` | `http://yuvomi:3000` | サイドカーから見た yuvomi |
| `DATA_DIR` | `/data` | 保存先。`records.json` をバックアップしてください |
| `PORT` | `8080` | 待ち受けポート |

サイドカーはリクエストごとに、ブラウザの Cookie を使って yuvomi の `/api/v1/auth/me` に本人と権限を問い合わせます。データベース（`yuvomi.db`）には触れません。

### 2. モジュールを入れる

- `modules/dividend-tracker/` を yuvomi の `modules/` フォルダにコピーする、または
- 設定の「カスタムモジュールを追加」で `https://github.com/shota-hamamatsu/dividend_tracker_yuvomi/tree/main/modules/dividend-tracker` を指定する（サーバー側で `MODULES_ALLOW_WEB_INSTALL=true` が必要）。

新規モジュールは無効状態で追加され、管理者の承認後に有効になります。

## 今後

- 受取予定の管理、税額・利回りの計算

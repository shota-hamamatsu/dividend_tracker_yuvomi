# dividend_tracker_yuvomi

[yuvomi.cloud](https://github.com/ulsklyc/yuvomi) の拡張機能（モジュール）として、配当（分配金）の管理を行うプロジェクトです。

## 目的

- 保有銘柄ごとの配当の記録・管理
- 受取予定・受取済みの配当の把握
- 年間・月間の配当収入の集計

## 現状（v0.1.0）

受取った配当を記録し、年ごとの合計を確認できる最小版です。

- 配当の追加（銘柄コード・銘柄名・受取日・受取額）と削除
- 年別合計と受取履歴の表示
- データはブラウザの `localStorage`（キー `dividend-tracker:v1`）に保存します。**ブラウザ・端末ごとに別データ**で、家族間では共有されません。
- 表示言語は日本語のみです。

## 構成

TypeScript + Vite で書き、yuvomi が読み込める 1 ファイルの JS にビルドします。

| 場所 | 内容 |
| --- | --- |
| `src/logic.ts` | 金額集計・検証・整形（DOM 非依存の純粋関数） |
| `src/index.ts` | 画面（`render(container, context)`） |
| `src/logic.test.ts` | ロジックのテスト |
| `modules/dividend-tracker/` | yuvomi に取り込まれるモジュール（`module.json`、`style.css`、ビルド済み `index.js`） |
| `docs/specs/` | 実装仕様書 |

`modules/dividend-tracker/index.js` はビルド生成物ですが、GitHub の URL からインストールする際にビルドが走らないため、**リポジトリにコミットします**。ソースを変更したら必ず `npm run build` してください。

## 開発

Node.js 22.12 以上が必要です。

```bash
npm install
npm run lint        # ESLint
npm run format:check # Prettier（整形は npm run format）
npm run typecheck   # 型チェック
npm test            # ロジックのテスト
npm run build       # modules/dividend-tracker/index.js を生成
```

## yuvomi への導入

- `modules/dividend-tracker/` を yuvomi の `modules/` フォルダにコピーする、または
- 設定の「カスタムモジュールを追加」で `https://github.com/shota-hamamatsu/dividend_tracker_yuvomi/tree/main/modules/dividend-tracker` を指定する（サーバー側で `MODULES_ALLOW_WEB_INSTALL=true` が必要）。

新規モジュールは無効状態で追加され、管理者の承認後に有効になります。

## 今後

- 家族間で共有するための保存先（サイドカーサービス、または yuvomi の API）
- 月別集計、受取予定の管理、税額・利回りの計算

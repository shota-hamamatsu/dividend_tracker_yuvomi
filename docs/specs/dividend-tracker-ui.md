# 仕様: 配当管理の画面（src/index.ts）

yuvomi のモジュールのエントリ。TypeScript（strict）。`enum` / `namespace` / デコレータは使わない。
`src/logic.ts` から次を import する（拡張子 `.ts` 付き）:
`DividendRecord, parseRecords, validateInput, yearlyTotals, sortByPayDateDesc, formatYen, newId`

## 公開する関数

```ts
export async function render(
  container: HTMLElement,
  context: { signal: AbortSignal },
): Promise<void>
```

- `container` は描画先のルート。`render` の外側（モジュール直下）に別の `render` を作らない。再描画用の内部関数は `draw` と名付ける。

## 禁止事項

- `innerHTML` / `outerHTML` という語を一切書かない（代入も読み取りも禁止）。
- `fetch` / `eval` / 外部 URL / `document.querySelector`（container の外を触らない）。
- DOM は `document.createElement` と `textContent` で組み立て、`container.replaceChildren(...)` で差し替える。

## データ

- 保存先: `localStorage` のキー `dividend-tracker:v1`。値は `DividendRecord[]` の JSON。
- 読み込み: `parseRecords(localStorage.getItem(KEY))`。`getItem` が例外を投げたら `null` 扱い。
- 保存: `localStorage.setItem` を try/catch で囲み、失敗時は画面にエラー文言「保存できませんでした」を表示する。
- `records` 配列は `render` 内で保持する。追加・削除のたびに保存して `draw()` を呼ぶ。

## 画面（上から順）

1. ツールバー: `div.page-toolbar` の中に `h1.page-toolbar__title`、文言「配当管理」。
2. 本文 `div.app-page__body` の中に 3 つの `section.page-section`:
   - **年別合計**: 見出し `h2`「年別合計」。`yearlyTotals(records)` を `ul` で `「2025年: 12,345円」` の形式（`formatYen` を使う）。0 件なら `p` で「まだ記録がありません」。
   - **追加フォーム**: 見出し `h2`「配当を追加」。`form.dt-form` に `label` + `input` を 4 つ:
     - 銘柄コード（text, name=ticker）
     - 銘柄名（text, name=name、任意）
     - 受取日（type=date, name=payDate）
     - 受取額（円）（type=number, name=amount, min=0, step=1）
     - 送信ボタン「追加」（type=submit）
     - エラー表示用の `p.dt-error`（常に存在。初期は空文字）。
   - **一覧**: 見出し `h2`「受取履歴」。`sortByPayDateDesc(records)` を `table.dt-table` で表示。列は 受取日 / 銘柄 / 銘柄名 / 受取額（`th.dt-num` / `td.dt-num`、`formatYen`）/ 操作。各行の最後に削除ボタン（`button` に `data-action="delete"` と `data-id`、文言「削除」）。0 件なら表の代わりに `p`「まだ記録がありません」。

## 動作

- イベントは `container` に委譲して 2 つだけ登録する。必ず `{ signal: context.signal }` を渡す:
  - `submit`: `e.preventDefault()`。`FormData` から値を取り、`validateInput({ticker, payDate, amountText})` が文字列を返したらそれを `p.dt-error` に表示して終了（保存しない）。
    OK なら `{ id: newId(), ticker: ticker.trim(), name: name.trim(), payDate, amount: Number(amountText) }` を `records` に追加 → 保存 → `draw()`（フォームは空に戻る）。
  - `click`: `e.target` を `Element` として `closest('[data-action="delete"]')` を探し、見つかれば `data-id` と一致するレコードを除いて保存 → `draw()`。
- `draw()` は毎回 DOM を作り直す。リスナーは `container` にのみ付いているので再登録しない。
- 最後に `draw()` を 1 回呼んで終了する。

## 出力形式
`src/index.ts` の内容のみ。説明文やコードフェンスは不要。

# 仕様: 配当管理の画面（src/index.ts）v0.2

yuvomi のモジュールのエントリ。TypeScript（strict）。`enum` / `namespace` / デコレータは使わない。
データはサイドカー（`docs/specs/dividend-tracker-sidecar.md`）に保存し、localStorage は使わない。
v0.1 の localStorage のデータは移行しない（読み込まない）。

## 公開する関数

```ts
export async function render(
  container: HTMLElement,
  context: { signal: AbortSignal },
): Promise<void>
```

## 禁止事項

- `innerHTML` / `outerHTML` という語を一切書かない。`eval`、外部 URL、`document.querySelector`（container の外）は使わない。
- DOM は `document.createElement` と `textContent` で組み立て、`container.replaceChildren(...)` で差し替える。
- 通信先は次の 2 つだけ:
  - `import { api } from '/api.js'` の `api.get('/family/members', { signal })`（家族一覧。応答 `{ data: [{ id, display_name }] }`）。
  - `fetch('/api/extensions/dividend-tracker/records...')`（相対パス、`credentials: 'same-origin'`、`cache: 'no-store'`、`signal`）。書き込みは `X-DT-CSRF` ヘッダーに GET で得た `csrfToken` を付ける。

## 状態

`records`、`members`（id → 表示名）、`me`（`{ id, isAdmin, canWrite }`）、`csrfToken`、`filter`（`number | null`、null = すべて）、`message`（エラー文言）。

## 起動時

1. 「読み込み中…」を表示。
2. 家族一覧と記録を並行して取得。どちらかが失敗したら「データを読み込めませんでした」と「再読み込み」ボタン（`data-action="reload"`）を表示。
3. 各 `await` の後で `signal.aborted` なら何もせず終了する。

## 画面（上から順）

1. ツールバー: `div.page-toolbar` > `h1.page-toolbar__title`「配当管理」。
2. 本文 `div.app-page__body` に `section.page-section` を 3 つ:
   - **年間配当合計**（一番上）: 見出し `h2`「年間配当合計」。直下に保有者フィルタ `label`「保有者」+ `select[name=filter]`（先頭「すべて」value=""、続いて家族を表示名で）。
     `yearlyTotals(filterByOwner(records, filter))` を `ul.dt-totals` で「2025年: 12,345円」。0 件なら `p`「まだ記録がありません」。
   - **受取履歴**: 見出し `h2`「受取履歴」。`sortByPayDateDesc(filterByOwner(records, filter))` を `table.dt-table`。
     列: 受取日 / 保有者 / 銘柄 / 銘柄名 / 保有株数（dt-num、3 桁区切り + 「株」）/ 1株配当（dt-num、`formatPerShare`）/ 受取額（dt-num、`formatYen`）/ 操作。
     保有者名は `members` から。見つからなければ「（不明なユーザー）」。
     削除ボタン（`data-action="delete"`、`data-id`、「削除」）は `me.canWrite` かつ（`me.isAdmin` または `ownerId === me.id`）の行だけ。0 件なら `p`「まだ記録がありません」。
   - **配当を追加**（`me.canWrite` のときだけ）: 見出し `h2`「配当を追加」。`form.dt-form`:
     - 保有者 `select[name=ownerId]`: 管理者は家族全員（初期値は自分）、それ以外は自分だけ。
     - 銘柄コード（text, name=ticker）、銘柄名（text, name=name、任意）、受取日（date, name=payDate）
     - 保有株数（number, name=shares, min=1, step=1）、1株当たり配当（円）（text, name=perShare, inputmode=decimal）
     - 送信ボタン「追加」。`p.dt-error`（常に存在）。
   - `me.canWrite` が false のときはフォームの代わりに `p`「閲覧のみの権限です」。

## 動作

- `container` に委譲したリスナー 3 つ（すべて `{ signal }`）:
  - `change`: 対象が `select[name=filter]` なら `filter` を更新して `draw()`。
  - `submit`: `preventDefault()`。`validateInput` でエラーなら `p.dt-error` に表示して終了。OK なら POST。送信中は追加ボタンを `disabled`。
    成功したら応答の `data` を `records` に追加し、`message = ''` で `draw()`（フォームは空に戻り、保有者は初期値）。
    失敗したら応答の `error`（無ければ「保存できませんでした」）を表示（入力は残す）。
  - `click`: `[data-action="delete"]` なら `confirm('この記録を削除しますか？')` の後 DELETE。成功で `records` から除いて `draw()`、失敗でメッセージ表示。
    `[data-action="reload"]` なら起動時の処理をやり直す。
- 401/403 は応答の `error` をそのまま表示する。

## 出力形式
`src/index.ts` の内容のみ。

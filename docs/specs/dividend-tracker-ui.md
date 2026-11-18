# 仕様: 配当管理の画面（src/index.ts）v0.7

yuvomi のモジュールのエントリ。TypeScript（strict）。`enum` / `namespace` / デコレータは使わない。
データはサイドカー（`docs/specs/dividend-tracker-sidecar.md` v0.4）に保存し、localStorage は使わない。
型と計算は `./logic.ts`（`docs/specs/dividend-tracker-logic.md` v0.4）から import する。

v0.3 の変更点: 1 記録に受取日を複数持てる。記録の一覧を表示し、**追加・編集はダイアログ**で行う（一覧の行クリックで編集、「追加」ボタンで新規）。
画面下部に置いていた追加フォームは廃止する。

v0.4 の変更点: 銘柄一覧の一番左に削除ボタンを追加（`DELETE /records/<id>`）。ダイアログの入力欄の並びを変更（1 段目: 保有者、2 段目: 銘柄コード・銘柄名、3 段目: 保有株数）。

v0.7 の変更点:
- 受取日は月日だけを選ぶ（年は選ばない）。
- 画面の並びを「銘柄一覧 → 合計額 → 月別配当額 → 年別配当額」にする。保有者フィルタは「銘柄一覧」の見出しの右に置く。
- 「年間配当合計」（受取日の年ごとの合計の一覧）を廃止し、「合計額」に現在の記録の 1 年分の合計を出す。
- 年を指定して「確定」を押すと、その年の配当合計として現在の合計額を登録する（`PUT /yearly-totals/<year>`）。
- 登録した年別合計を、月別配当額の下に 12 年分の棒グラフで出す（`docs/specs/dividend-tracker-monthly-chart.md` v0.3）。

v0.6 の変更点: ダイアログの保有者を保有株数の下に移す（1 段目: 銘柄コード・銘柄名、2 段目: 保有株数、3 段目: 保有者）。月別配当額のグラフは `docs/specs/dividend-tracker-monthly-chart.md` v0.2 に従う。

v0.5 の変更点: 一覧の削除ボタンを × アイコンのボタンにする。一覧は横スクロールさせない（受取日・銘柄は折り返す）。

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
  - `fetch('/api/extensions/dividend-tracker/records...')`（相対パス、`credentials: 'same-origin'`、`cache: 'no-store'`、`signal`）。
    書き込み（追加の POST、編集の `PUT /records/<encodeURIComponent(id)>`、削除の `DELETE /records/<encodeURIComponent(id)>`）は `X-DT-CSRF` ヘッダーに GET で得た `csrfToken` を付ける。
  - `fetch('/api/extensions/dividend-tracker/yearly-totals/<year>', { method: 'PUT' })`（年別合計の登録。本文なし、`X-DT-CSRF` を付ける）。

## 状態

`records`、`yearlyTotals`（GET の応答の `yearlyTotals` のうち `isValidYearlyTotal` を満たすもの）、`registerYear`（年の入力欄の値。既定は今年）、`totalsMessage`（合計額の欄に出す結果の文言。既定は空）、`members`（id → 表示名）、`me`（`{ id, isAdmin, canWrite }`）、`csrfToken`、`filter`（`number | null`、null = すべて）、`listError`（銘柄一覧に出すエラー文言。既定は空）。

## 起動時（v0.2 と同じ）

1. 「読み込み中…」を表示。
2. 家族一覧と記録を並行して取得。どちらかが失敗したら「データを読み込めませんでした」（応答に `error` があればそれ）と「再読み込み」ボタン（`data-action="reload"`）を表示。
3. 各 `await` の後で `signal.aborted` なら何もせず終了する。

## 画面（上から順）

1. ツールバー: `div.page-toolbar` > `h1.page-toolbar__title`「配当管理」。
2. 本文 `div.app-page__body` に `section.page-section` を 4 つ（上から）:
   - **銘柄一覧**: 見出し行 `div.dt-heading` に、左から `h2`「銘柄一覧」、保有者フィルタ `label.dt-filter`「保有者」+ `select[name=filter]`（先頭「すべて」value=""、続いて家族を表示名で）、
     `me.canWrite` のときだけ右端に `button[data-action="add"]`「追加」。
     - `me.canWrite` が false のときは見出しの下に `p`「閲覧のみの権限です」。
     - 見出しの下に `p.dt-error`（常に存在、内容は `listError`）。
     - 対象は `sortForList(filterByOwner(records, filter))`。0 件なら `p`「まだ記録がありません」。
     - 1 件以上なら `table.dt-list`。`thead` の列: `me.canWrite` のときだけ先頭に削除列（見出しの文字は空、`th` に `aria-label="削除"`）、続いて「保有者」「銘柄」「保有株数」「受取日」「合計」。
     - 削除列のセル `td.dt-delete-cell`: 編集できる行には `button[data-action="delete"]`。表示は `×`（U+00D7）だけ（type=button、`.dt-button--danger`、`aria-label="<銘柄の表示> を削除"`、`title="削除"`）。編集できない行は空のセル。
     - 各行 `tr`: 保有者名 / `ticker` と `name`（name が空でなければ `7203 トヨタ自動車` のように半角スペースで連結）/ `shares` を 3 桁区切り + `株` /
       受取日（`payments` の `payDate` を `M/D` 形式（例 `3/31`、先頭 0 なし）で `、` 区切り）/ `formatYen(recordTotal(record))`。
     - 編集できる行（`me.canWrite` かつ（`me.isAdmin` または `record.ownerId === me.id`））には `tr.dt-row--editable`、`data-id="<id>"`、`tabindex="0"` を付ける。
       それ以外の行はクリックしても何もしない。
   - **合計額**: 見出し `h2`「合計額」。
     - `p.dt-total` に `formatYen(annualTotals(filterByOwner(records, filter)).total)`（現在の記録の 1 年分。保有者ごとの内訳は出さない）。
     - `me.canWrite` のときだけ、登録欄 `div.dt-register`: `label`「登録する年」+ `input[name=registerYear]`（number、min=2000、max=2100、step=1、値は `registerYear`）と
       `button[data-action="register-year"]`「確定」。その下に `p.dt-register__message`（`aria-live="polite"`、内容は `totalsMessage`）。
     - 登録は保有者フィルタに関係なく **全員分** の合計（サーバーが計算する）。フィルタ中は登録欄の近くに `p`「登録されるのは全員分の合計です」を出す。
   - **月別配当額**・**年別配当額**: `docs/specs/dividend-tracker-monthly-chart.md` v0.3。

## ダイアログ

`dialog.dt-dialog` を 1 つ作り、`container` に追加して `showModal()` で開く。閉じたら（`close` イベント）`container` から取り除く。
同時に 2 つ以上開かない（開いていれば新しく開かない）。

- 見出し `h2`: 新規は「配当を追加」、編集は「配当を編集」。
- `form.dt-form`（`method="dialog"` は使わない。送信は下記の `submit` で処理）:
  - 入力欄は次の順で並べる（`form.dt-form` は 2 列の grid）:
    - 1 段目: 左に銘柄コード（text, name=ticker）、右に銘柄名（text, name=name、任意）。
    - 2 段目（`label.dt-field--shares`、左の列だけ）: 保有株数（number, name=shares, min=1, step=1）。
    - 3 段目（2 列ぶち抜き、`label.dt-field--wide`）: 保有者 `select[name=ownerId]`。管理者は家族全員、それ以外は自分だけ。初期値は新規なら自分、編集なら記録の `ownerId`（家族にいなければ「（不明なユーザー）」の選択肢を追加して選ぶ）。
    - 編集時は記録の値を入れる。
  - `fieldset.dt-payments` > `legend`「受取日と1株当たり配当」。受取日の行 `div.dt-payment` を並べる。各行:
    - 受取日（`div.dt-payday` に `select[name=payMonth]`（先頭は空の選択肢「月」、続いて `1月`〜`12月`、value は `01`〜`12`）と `select[name=payDay]`（先頭は空の選択肢「日」、続いて `1日`〜`31日`、value は `01`〜`31`）。年は選ばない）、
      1株当たり配当（円）（text, name=perShare, inputmode=decimal）、`button[data-action="remove-payment"]`「削除」（type=button）。
    - 新規は空の行を 1 つ。編集は記録の `payments` を順に（1株配当は 1/100 円単位から `12` / `37.5` / `0.05` のような文字列に戻す。3 桁区切りや「円」は付けない）。
    - 行が 1 つだけのときは「削除」を `disabled` にする。
  - `button[data-action="add-payment"]`「受取日を追加」（type=button）。押すと空の行を末尾に追加。MAX_PAYMENTS 行あるときは `disabled`。
  - `p.dt-error`（常に存在）。
  - ボタン行 `div.dt-actions`: `button[data-action="cancel"]`「キャンセル」（type=button、押すと閉じる）と、送信ボタン（新規「追加」、編集「保存」）。
- 入力値は、ダイアログ内の各行の `name=payMonth`・`name=payDay`・`name=perShare` を行の順に読み、`RecordInput` を組み立てる（`payments: [{ payDate, perShareText }]`）。
  `payDate` は `<月>-<日>`（例 `06-30`）。月か日が空なら空文字（`validateInput` が「受取日を正しく選んでください」を返す）。
- Esc キーでも閉じる（`dialog` の標準動作）。

## 動作

- 保有者名は `members` から。見つからなければ「（不明なユーザー）」。
- `container` に委譲したリスナー（すべて `{ signal }`）:
  - `change`: 対象が `select[name=filter]` なら `filter` を更新して `draw()`。
  - `input`: 対象が `input[name=registerYear]` なら `registerYear` に値を入れる（`draw()` はしない）。
  - 追加・編集・保有者フィルタの変更で `draw()` するときは `listError = ''` にする。
  - `click`:
    - `[data-action="reload"]` → 起動時の処理をやり直す。
    - `[data-action="add"]` → 新規のダイアログを開く。
    - `[data-action="add-payment"]` / `[data-action="remove-payment"]` → ダイアログ内の行を追加・削除し、削除・追加ボタンの `disabled` を更新する。
    - `[data-action="cancel"]` → ダイアログを閉じる。
    - `[data-action="register-year"]` → 年別合計を登録する:
      1. `parseYear(registerYear)` が null なら `totalsMessage`「年は2000〜2100で指定してください」で `draw()` して終了。
      2. その年が `yearlyTotals` に登録済みなら `window.confirm('<年>年の配当合計は登録済みです（<登録済みの額>）。現在の合計額で置き換えますか？')`。false なら何もしない。
      3. `PUT /yearly-totals/<年>` を送る（送信中はボタンを `disabled`）。
      4. 成功したら応答の `data`（`isValidYearlyTotal` を満たすもの）で `yearlyTotals` の同じ年を置き換え（無ければ追加して年の昇順に並べ）、`totalsMessage`「<年>年の配当合計を登録しました（<額>）」で `draw()`。
      5. 失敗したら `totalsMessage` に応答の `error`（無ければ「登録できませんでした」）を入れて `draw()`。
    - `[data-action="delete"]` → その行の `data-id` の記録を削除する（編集ダイアログは開かない）:
      1. `window.confirm('「<銘柄の表示>」（<保有者名>）を削除しますか？この操作は取り消せません。')` が false なら何もしない。
      2. `DELETE` を送る（送信中はそのボタンを `disabled`）。
      3. 成功（2xx）したら `records` からその id を除き、`listError = ''` で `draw()`。
      4. 失敗したら `listError` に応答の `error`（無ければ「削除できませんでした」）を入れて `draw()`。
    - 銘柄の表示は一覧と同じ（`7203 トヨタ自動車`、name が空なら ticker だけ）。
    - `tr.dt-row--editable` の中（ボタン以外）→ その `data-id` の記録の編集ダイアログを開く。
  - `keydown`: `tr.dt-row--editable` にフォーカスがある状態で Enter または Space → 編集ダイアログを開く（`preventDefault()`）。
  - `submit`（ダイアログの `form.dt-form`）: `preventDefault()`。`validateInput` でエラーなら `p.dt-error` に表示して終了。
    OK なら新規は POST、編集は PUT。送信中は送信ボタンを `disabled`。
    成功したら応答の `data`（`isValidRecord` を満たすもの）で `records` を更新（新規は追加、編集は同じ id を置き換え）し、ダイアログを閉じて `draw()`。
    失敗したら応答の `error`（無ければ「保存できませんでした」）をダイアログの `p.dt-error` に表示する（ダイアログは開いたまま、入力は残す）。
- 401/403 は応答の `error` をそのまま表示する。

## スタイル（`modules/dividend-tracker/style.css`）

既存のトークンを使う（値はトークンが無い場合の保険）。追加するクラス: `.dt-heading`（h2・保有者フィルタ・ボタンを横並び。h2 とフィルタは左寄せ、ボタンは右端。狭い画面では折り返す）、`.dt-filter`（ラベルと select を横並び）、`.dt-total`（大きめの太字、`tabular-nums`）、`.dt-register`（ラベル・年の入力・確定ボタンを横並び、折り返し可。年の入力は幅 6rem 程度）、`.dt-payday`（月と日の select を横並び）、`.dt-list`（幅 100%、数値列は右寄せ・`tabular-nums`・折り返さない。保有者のセル `td.dt-owner` も折り返さない。「銘柄」「受取日」の列は折り返す。横スクロールは出さない。表を `div.dt-list-wrap` で包まない）、
`.dt-row--editable`（`cursor: pointer`、hover とフォーカスで背景色を薄く変える）、`.dt-dialog`（最大幅 32rem、背景 `--color-bg`、文字色 `--color-text-primary`）、`.dt-payments`、`.dt-payment`（日付・1株配当・削除を横並び）、`.dt-actions`（右寄せ）。
入力欄（`input`・`select`）は枠線 1px（色は `--color-text-secondary` を 50% 透過）、角丸 `0.5rem`、内側の余白 `--space-2`（上下）・`--space-3`（左右）。
ボタンは既存の `.dt-form button` と同じ見た目。「キャンセル」「削除」（受取日の行）「受取日を追加」は `.dt-button--secondary` を付け、塗りなし（枠線のみ）。一覧の削除ボタン `.dt-button--danger` は 32px 四方のアイコンボタン（枠線・塗りなしで × だけを表示。× は 1.75rem と大きめ、文字色 `--color-danger-ink`）。狭い画面（30rem 未満）では一覧のセルの左右の余白を詰め、見出しは折り返し可、本文の文字を 0.875rem にする。ダイアログの `.dt-form` は `grid-template-columns: repeat(2, minmax(0, 1fr))`、`.dt-field--wide`・受取日の枠・エラー・ボタン行は 2 列ぶち抜き。狭い画面（30rem 未満）では受取日の行を 2 段（受取日／1株配当と削除）にする。

## 出力形式

`src/index.ts` の内容のみ。

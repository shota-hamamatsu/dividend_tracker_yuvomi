# 仕様: 表示言語の切り替え v0.6

yuvomi の表示言語に合わせて、画面の文字・日付・数値・金額の書き方を切り替える。yuvomi が対応する **27 言語すべて** に対応する。

前提: `docs/specs/dividend-tracker-currency.md` v0.5 までの仕様。この仕様に書いていないことは変えない（画面の構成・計算・保存形式・権限は v0.5 のまま）。

## 対応する言語

yuvomi の `public/locales/` と同じ 27 言語:

`ar` `cs` `de` `el` `en` `es` `fa` `fil` `fr` `hi` `hu` `id` `it` `ja` `ko` `nb` `nl` `pl` `pt` `pt-BR` `ru` `sv` `tr` `uk` `vi` `zh` `zh-Hant`

- 右から左に書く言語は `ar`・`fa`。yuvomi が `<html dir="rtl">` にするので、このモジュールは `dir` を自分で設定しない（下の「右から左の言語」）。
- 翻訳の元は日本語（`ja`）と英語（`en`）。この 2 つは下の「文言」の表のとおりにする。ほかの 25 言語は、この 2 つから翻訳して用意する。機械翻訳と同程度の質になるため、README に「誤りがあれば報告してほしい」と書く。

## yuvomi の仕組み（調べた結果）

yuvomi の `MODULES.md`「Localization」と `public/i18n.js` による。

- モジュールのフォルダに `locales/<言語>.json`（平らなキー）を置くと、yuvomi がモジュールの読み込み時に取り込む。
- モジュールの JS では `import { t } from '/i18n.js'` の `t('extensions.dividend-tracker.<キー>', params)` で取り出す。
  - 探す順: ユーザーの表示言語 → `module.json` の `i18n.defaultLocale` → `en` → `de` → キーそのもの。
  - `{{name}}` の形の差し込みができる（`params.name`）。
  - `params.count` が数値なら、言語の複数形の規則で `<キー>_one`・`<キー>_other` などを選ぶ（`_zero` `_one` `_two` `_few` `_many` `_other`。`Intl.PluralRules` の分類名）。
- `module.json` の `menu.labelKey`・`capabilities.permissions.module.labelKey` に短いキーを書くと、メニューと「役割と権限」の名前も翻訳される。
- `/i18n.js` は `getLocale()`（表示言語）と `getFormatLocale()`（数値の書き方の地域。設定が無ければ表示言語）も export している。ただし MODULES.md が使い方を書いているのは `t` だけなので、この 2 つは **無くても動くように** 使う（下の「言語の取得」）。
- 表示言語を変えると `window` に `locale-changed` イベントが出る。

## 対象ファイル

| ファイル | 変更 |
| --- | --- |
| `modules/dividend-tracker/locales/<言語>.json` | 新規。27 ファイル |
| `modules/dividend-tracker/module.json` | `i18n`・`labelKey` を追加。名前・説明を英語に |
| `src/types/i18n.d.ts` | 新規。`/i18n.js` の型 |
| `tsconfig.json` | `/i18n.js` の型の場所。必要なら `lib` に `ES2023.Intl`（`Intl.NumberFormat#format` に文字列を渡すため） |
| `src/logic.ts` | 入力エラーをコードで返す。表示用の整形を外し、小数の文字列を返す関数にする |
| `src/logic.test.ts` | 上のテスト |
| `src/locales.test.ts` | 新規。翻訳ファイルの検査 |
| `src/index.ts` | 文字をすべて `t()` に。日付・数値・金額を言語に合わせる |
| `modules/dividend-tracker/style.css` | 左右を論理プロパティにする（右から左の言語） |
| `server/app.ts` | エラーをコードで返す（`error` は英語） |
| `server/app.test.ts` | 上のテスト |
| `dev/mock-i18n.ts`・`dev/main.ts`・`dev/mock-records.ts`・`vite.dev.config.ts` | 画面確認ページで言語を選べるようにする |
| `docs/specs/dev-preview.md` | 上の変更 |
| `README.md`・`package.json`・`module.json` | v0.6.0 |

## `/i18n.js` の使い方（`src/index.ts`）

```ts
import * as i18n from '/i18n.js';
```

- 名前付き import（`import { getLocale } from …`）は使わない。yuvomi の版によって無い関数があると、モジュール全体の読み込みが失敗するため。
- `src/types/i18n.d.ts`:

```ts
export declare function t(key: string, params?: Record<string, string | number>): string;
export declare const getLocale: (() => string) | undefined;
export declare const getFormatLocale: (() => string) | undefined;
```

- 文言の取り出しは 1 つの関数にまとめる: `tr(key, params?)` = `i18n.t('extensions.dividend-tracker.' + key, params)`。
- 言語の取得（`draw()` のたびに取り直す）:
  - 表示言語 `uiLocale` = `i18n.getLocale?.()`、無ければ `document.documentElement.lang`、それも空なら `'en'`。
  - 数値の地域 `formatLocale` = `i18n.getFormatLocale?.()`、無ければ `uiLocale`。
  - `Intl` に渡して `RangeError` になる値なら `'en'` を使う（`Intl.getCanonicalLocales` で確かめる）。
- `window` の `locale-changed`（`{ signal }` 付きで登録）で `draw()` する。開いているダイアログはそのまま（次に開いたときから新しい言語）。
  - そのため `draw()` は `container.replaceChildren` で全部を差し替えず、開いているダイアログ以外の子を外してから、ツールバーと本文を先頭に入れる（開いている `dialog` を DOM から外すと `close` が来ないまま残り、次のダイアログが開けなくなるため）。
- 一覧の表は言語によって見出しや「保有株数」の文字が長くなるため、見出し（`th`）と保有株数のセル（`td.dt-shares`）は折り返す。見出しは `hyphens: auto` と `overflow-wrap: anywhere` で長い 1 語も折り返す。金額のセルと保有者のセルは v0.5 のまま折り返さない。

## 日付・数値・金額の書き方（`src/index.ts`）

`Intl` だけを使う。日付は表示言語、数値と金額は数値の地域で書く。`Intl` のオブジェクトは言語とオプションごとに使い回してよい。

| 何を | 書き方 | 例（ja / en / de） |
| --- | --- | --- |
| 金額 | `Intl.NumberFormat(formatLocale, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d })` に `amountDecimal(amount, currency)`（下）を **文字列で** 渡す。d は JPY 0、それ以外 2 | `￥1,234` / `¥1,234` / `1.234 ¥`、`$52.00` / `$52.00` / `52,00 $` |
| 保有株数などの整数 | `Intl.NumberFormat(formatLocale)` | `1,000` / `1,000` / `1.000` |
| 受取日（一覧） | `Intl.DateTimeFormat(uiLocale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })` に `Date.UTC(2000, 月 - 1, 日)` | `6/30` / `6/30` / `30.6.` |
| 月別グラフのラベル | `Intl.DateTimeFormat(uiLocale, { month: 'short', timeZone: 'UTC' })` | `6月` / `Jun` / `Juni` |
| 月の選択肢・読み上げ | `{ month: 'long' }` | `6月` / `June` / `Juni` |
| 年別グラフのラベル | `Intl.NumberFormat(formatLocale, { useGrouping: false })` | `2026` |
| 年の読み上げ・メッセージ | `Intl.DateTimeFormat(uiLocale, { year: 'numeric', timeZone: 'UTC' })` に `Date.UTC(年, 0, 1)` | `2026年` / `2026` / `2026` |
| 日の選択肢 | 文言 `field.day_option`（`{{day}}` に整数の書き方） | `30日` / `30` / `30` |
| 通貨の選択肢 | 文言 `currency.option`（`{{name}}` に `Intl.DisplayNames(uiLocale, { type: 'currency' })`、無ければ通貨コード。`{{code}}` に通貨コード） | `米ドル（USD）` / `US Dollar (USD)` |
| 一覧の区切り | 文言 `common.separator` | `、` / `, ` |

- 金額の計算には `Intl` を使わない（表示だけ）。`amountDecimal` が文字列を作り、`Intl` はその文字列を書き換えるだけなので、浮動小数点の誤差は出ない。
- `fa`・`ar` などで `Intl` が自分の数字（`۱۲۳`）を使うのはそのままでよい。
- 入力欄（保有株数・1株配当・年）は従来どおり半角の `0-9` と `.` だけを受け付ける。欄の近くに書式の説明は出さない（エラーの文言で伝える）。

## `src/logic.ts` の変更

### 入力エラーのコード

`validateInput` は文言の代わりにコードを返す。

```ts
export type InputErrorCode =
  | 'owner_required' | 'currency_required' | 'ticker_required' | 'shares_invalid'
  | 'payments_required' | 'payments_too_many' | 'pay_date_invalid'
  | 'per_share_invalid' | 'pay_date_duplicate';

export interface InputError {
  code: InputErrorCode;
  params?: Record<string, number>; // payments_too_many: { max }、per_share_invalid: { decimals }
}

export function validateInput(input: RecordInput): InputError | null
```

判定の順は v0.5 と同じ。v0.5 の文言との対応:

| コード | v0.5 の文言 | params |
| --- | --- | --- |
| `owner_required` | 保有者を選んでください | |
| `currency_required` | 通貨を選んでください | |
| `ticker_required` | 銘柄コードを入力してください | |
| `shares_invalid` | 保有株数は1以上の整数で入力してください | |
| `payments_required` | 受取日を1つ以上入力してください | |
| `payments_too_many` | 受取日は24件までです | `{ max: MAX_PAYMENTS }` |
| `pay_date_invalid` | 受取日を正しく選んでください | |
| `per_share_invalid` | 1株当たり配当は0以上、小数第N位までで入力してください | `{ decimals: perShareDecimals(currency) }` |
| `pay_date_duplicate` | 同じ受取日が重複しています | |

### 表示用の整形

- 削除: `formatAmount`・`formatPerShare`（言語に依存するので画面側で `Intl` を使う）。
- 追加: `amountDecimals(currency): number`（JPY 0、それ以外 2）。
- 追加: `amountDecimal(amount: number, currency: Currency): string` — 金額を小数の文字列にする。3 桁区切り・通貨記号は付けない。`(1234, 'JPY')` → `'1234'`、`(123456, 'USD')` → `'1234.56'`、`(5, 'USD')` → `'0.05'`、`(0, 'EUR')` → `'0.00'`。文字列操作で作る。
- `perShareInputText` は v0.5 のまま（入力欄は言語に関係なく `.` 区切り）。

## サイドカー（`server/app.ts`）

- エラーの応答を `{ error: <英語の文>, code: <コード>, params?: {...} }` にする。画面は `code` で翻訳する。`error` は curl やログで読むためのもの。
- コードは次のとおり（v0.5 で 1 つのコードに複数の文言があったものは分ける）:

| HTTP | コード | `error`（英語） |
| --- | --- | --- |
| 415 | `unsupported_media_type` | Send the data as JSON. |
| 413 | `too_large` | The data is too large. |
| 400 | `bad_json` | The data format is invalid. |
| 400 | `bad_request` | The data format is invalid. |
| 400 | 入力エラーのコード（上の表）。`params` も付ける | 下の文言表の `en` と同じ文 |
| 400 | `unknown_owner` | The holder is not in your family. |
| 400 | `invalid_year` | Enter a year from 2000 to 2100.（`params: { min, max }`） |
| 401 | `unauthenticated` | Please sign in. |
| 403 | `forbidden` | You do not have permission to use this module. |
| 403 | `bad_origin` | Invalid request. |
| 403 | `csrf` | Reload the page and try again. |
| 403 | `read_only` | You have view-only access. |
| 403 | `not_owner_add` | Only admins can add records for other people. |
| 403 | `not_owner_edit` | Only admins can edit other people's records. |
| 403 | `not_owner_delete` | Only admins can delete other people's records. |
| 404 | `record_not_found` | Record not found. |
| 404 | `not_found` | Not found. |
| 405 | `method` | This operation is not allowed. |
| 500 | `save_failed` | Could not save. |
| 500 | `internal` | A server error occurred. |
| 502 | `yuvomi_unreachable` | Could not connect to yuvomi. |

- v0.5 の `invalid`（入力エラーと年の両方）は、入力エラーのコードと `invalid_year` に分ける。v0.5 の `not_owner` は 3 つに分ける。記録が無いときの `not_found` は `record_not_found` にする。
- `server/main.ts` の起動時のメッセージ（運用者向け）は日本語のままでよい。

## 画面（`src/index.ts`）

- 画面に出す文字（見出し・ボタン・ラベル・`aria-label`・`title`・確認・メッセージ）は、すべて下の「文言」のキーで `tr()` から取る。日本語の文字列をコードに書かない（コメントは除く）。
- サーバーのエラー: 応答の `code` について `errors.<code>` を `tr(…, params)` で引き、結果がキーのまま（訳が無い）なら、操作ごとの「〜できませんでした」の文言を使う。応答の `error`（英語）は画面に出さない。
- `validateInput` のエラー: `errors.<code>` を `params` 付きで引く。
- 年の入力エラー（画面側の判定）は `errors.invalid_year`（`{ min: MIN_YEAR, max: MAX_YEAR }`）。
- 保有株数は `tr('list.shares', { count: 株数, shares: 整数の書き方 })`（複数形を選ぶため `count` に数値を渡し、表示には `shares` を使う）。
- 金額の一覧（合計額の登録メッセージ・確認、グラフの内訳）は `common.separator` でつなぐ。

## 文言（`locales/<言語>.json`）

- 平らなキー。下の表のキーをすべて持つ（複数形のキーは、その言語の複数形の分類の分だけ。`_other` は必ず持つ）。
- 差し込み（`{{…}}`）の名前は日本語・英語と同じにする。訳文で差し込みを落とさない・増やさない。
- `ja`・`en` は下の表のとおり。

| キー | ja | en |
| --- | --- | --- |
| `menu` | 配当 | Dividends |
| `module` | 配当管理 | Dividend Tracker |
| `title` | 配当管理 | Dividend Tracker |
| `loading` | 読み込み中… | Loading… |
| `reload` | 再読み込み | Reload |
| `common.unknown_user` | （不明なユーザー） | (Unknown user) |
| `common.separator` | 、 | `, ` |
| `list.title` | 銘柄一覧 | Holdings |
| `list.filter` | 保有者 | Holder |
| `list.filter_all` | すべて | All |
| `list.add` | 追加 | Add |
| `list.read_only` | 閲覧のみの権限です | You have view-only access. |
| `list.empty` | まだ記録がありません | No records yet. |
| `list.col_owner` | 保有者 | Holder |
| `list.col_ticker` | 銘柄 | Stock |
| `list.col_shares` | 保有株数 | Shares |
| `list.col_pay_dates` | 受取日 | Pay dates |
| `list.col_total` | 合計 | Total |
| `list.delete` | 削除 | Delete |
| `list.delete_label` | {{label}} を削除 | Delete {{label}} |
| `list.shares_one` | — | {{shares}} share |
| `list.shares_other` | {{shares}}株 | {{shares}} shares |
| `list.confirm_delete` | 「{{label}}」（{{owner}}）を削除しますか？この操作は取り消せません。 | Delete "{{label}}" ({{owner}})? This cannot be undone. |
| `totals.title` | 合計額 | Total |
| `totals.register_year` | 登録する年 | Year to register |
| `totals.register` | 確定 | Register |
| `totals.all_owners_note` | 登録されるのは全員分の合計です | The total for everyone is registered. |
| `totals.confirm_replace` | {{year}}の配当合計は登録済みです（{{amount}}）。現在の合計額で置き換えますか？ | A total for {{year}} is already registered ({{amount}}). Replace it with the current total? |
| `totals.registered` | {{year}}の配当合計を登録しました（{{amount}}） | Registered the total for {{year}} ({{amount}}). |
| `chart.monthly` | 月別配当額 | Dividends by month |
| `chart.yearly` | 年別配当額 | Dividends by year |
| `chart.currency` | 通貨 | Currency |
| `chart.no_years` | まだ登録された年がありません | No years registered yet. |
| `chart.bar` | {{name}}: {{amount}} | {{name}}: {{amount}} |
| `chart.bar_breakdown` | {{name}}: {{amount}}（{{breakdown}}） | {{name}}: {{amount}} ({{breakdown}}) |
| `chart.owner_amount` | {{owner}} {{amount}} | {{owner}} {{amount}} |
| `dialog.add_title` | 配当を追加 | Add dividend |
| `dialog.edit_title` | 配当を編集 | Edit dividend |
| `dialog.add_payment` | 受取日を追加 | Add pay date |
| `dialog.remove_payment` | 削除 | Remove |
| `dialog.cancel` | キャンセル | Cancel |
| `dialog.submit_add` | 追加 | Add |
| `dialog.submit_save` | 保存 | Save |
| `field.ticker` | 銘柄コード | Ticker |
| `field.name` | 銘柄名 | Name |
| `field.shares` | 保有株数 | Shares |
| `field.currency` | 通貨 | Currency |
| `field.owner` | 保有者 | Holder |
| `field.payments` | 受取日と1株当たり配当 | Pay dates and dividend per share |
| `field.pay_date` | 受取日 | Pay date |
| `field.pay_month` | 受取日の月 | Pay month |
| `field.pay_day` | 受取日の日 | Pay day |
| `field.month_placeholder` | 月 | Month |
| `field.day_placeholder` | 日 | Day |
| `field.day_option` | {{day}}日 | {{day}} |
| `field.per_share` | 1株当たり配当 | Dividend per share |
| `currency.option` | {{name}}（{{code}}） | {{name}} ({{code}}) |
| `errors.load_failed` | データを読み込めませんでした | Could not load the data. |
| `errors.save_failed` | 保存できませんでした | Could not save. |
| `errors.delete_failed` | 削除できませんでした | Could not delete. |
| `errors.register_failed` | 登録できませんでした | Could not register. |
| `errors.owner_required` | 保有者を選んでください | Choose a holder. |
| `errors.currency_required` | 通貨を選んでください | Choose a currency. |
| `errors.ticker_required` | 銘柄コードを入力してください | Enter a ticker. |
| `errors.shares_invalid` | 保有株数は1以上の整数で入力してください | Enter the shares as a whole number of 1 or more. |
| `errors.payments_required` | 受取日を1つ以上入力してください | Add at least one pay date. |
| `errors.payments_too_many` | 受取日は{{max}}件までです | You can add up to {{max}} pay dates. |
| `errors.pay_date_invalid` | 受取日を正しく選んでください | Choose a valid pay date. |
| `errors.per_share_invalid` | 1株当たり配当は0以上、小数第{{decimals}}位までで入力してください | Enter the dividend per share as 0 or more, with up to {{decimals}} decimal places. |
| `errors.pay_date_duplicate` | 同じ受取日が重複しています | The same pay date appears more than once. |
| `errors.invalid_year` | 年は{{min}}〜{{max}}で指定してください | Enter a year from {{min}} to {{max}}. |
| `errors.unknown_owner` | 保有者が家族にいません | The holder is not in your family. |
| `errors.unsupported_media_type` | JSON で送信してください | Send the data as JSON. |
| `errors.too_large` | データが大きすぎます | The data is too large. |
| `errors.bad_json` | データの形式が正しくありません | The data format is invalid. |
| `errors.bad_request` | データの形式が正しくありません | The data format is invalid. |
| `errors.unauthenticated` | ログインしてください | Please sign in. |
| `errors.forbidden` | このモジュールを使う権限がありません | You do not have permission to use this module. |
| `errors.bad_origin` | 不正なリクエストです | Invalid request. |
| `errors.csrf` | 画面を再読み込みしてから、もう一度お試しください | Reload the page and try again. |
| `errors.read_only` | 閲覧のみの権限です | You have view-only access. |
| `errors.not_owner_add` | 自分以外の記録は管理者だけが追加できます | Only admins can add records for other people. |
| `errors.not_owner_edit` | 自分以外の記録は管理者だけが編集できます | Only admins can edit other people's records. |
| `errors.not_owner_delete` | 自分以外の記録は管理者だけが削除できます | Only admins can delete other people's records. |
| `errors.record_not_found` | 記録が見つかりません | Record not found. |
| `errors.not_found` | 見つかりません | Not found. |
| `errors.method` | 許可されていない操作です | This operation is not allowed. |
| `errors.internal` | サーバーでエラーが発生しました | A server error occurred. |
| `errors.yuvomi_unreachable` | yuvomi に接続できませんでした | Could not connect to yuvomi. |

- 日本語は複数形の区別が無いので、`ja.json` は `list.shares_other` だけを持つ（表の「—」は、そのキーを置かないという意味）。
- `{{year}}` には「年の読み上げ」の書き方（ja は `2026年`）が入る。日本語の文で「年」を重ねない。

## `module.json`

- 追加: `"i18n": { "defaultLocale": "en" }`、`menu.labelKey: "menu"`、`capabilities.permissions.module.labelKey: "module"`。
- `menu.label`・`capabilities.permissions.module.label`（翻訳が無いときの最後の表示）は英語にする（`Dividends`・`Dividend Tracker`）。
- `name`・`description` は yuvomi が翻訳しない項目なので英語にする（`Dividend Tracker`、説明は英語で v0.5 と同じ内容）。

## 右から左の言語（`style.css`）

`ar`・`fa` では yuvomi が `<html dir="rtl">` にする。モジュールの CSS は左右を決め打ちしない:

- `margin-left` / `margin-right` / `padding-left` / `padding-right` / `left` / `right` / `text-align: left|right` を、`margin-inline-start` などの論理プロパティ、`text-align: start|end` に置き換える。
- 棒グラフは grid の並びに任せる（右から左の言語では 1 月・古い年が右端になる）。
- ツールチップの位置は JS で `left` を計算しているが、`div.dt-chart-wrap` の中の座標なので `dir` に関係なく合う。変えない。

## 画面確認ページ（`dev/`）

- `dev/mock-i18n.ts`（新規）: yuvomi の `/i18n.js` の代わり。`vite.dev.config.ts` で `/i18n.js` をこれに差し替える（`/api.js` と同じ方法）。
  - `modules/dividend-tracker/locales/*.json` を `import.meta.glob`（eager）で読み込む。
  - `t(key, params)`: `extensions.dividend-tracker.` を外したキーを、表示言語 → `en` の順に探す。`params.count` が数値なら `Intl.PluralRules(表示言語)` の分類で `<キー>_<分類>` → `<キー>_other` → `<キー>` の順に探す。`{{name}}` を `params` で差し込む。見つからなければキーそのものを返す。
  - `getLocale()`・`getFormatLocale()`: ツールバーで選んだ言語。
  - 言語を変えたら `document.documentElement.lang` と `dir`（`ar`・`fa` は `rtl`）を設定し、`window` に `locale-changed` を出す。
- ツールバーに言語の選択（27 言語。初期値は URL の `?lang=`、無ければ `ja`）を追加する。URL に `lang` を残す（`scenario` と両方）。
- `dev/mock-records.ts` のエラー応答もサイドカーと同じ `{ error, code, params }` にする。

## 受け入れ条件

- logic（テスト）:
  - `validateInput` が上の表のコードと `params` を返す（v0.5 の各ケース）。
  - `amountDecimal`・`amountDecimals` が上の例のとおり。
- 翻訳ファイル（`src/locales.test.ts`）:
  - 27 言語のファイルがそろっている（多くも少なくもない）。
  - どのファイルも、複数形の接尾辞（`_zero` `_one` `_two` `_few` `_many` `_other`）を除いたキーの集まりが `en.json` と同じ。複数形のキーには必ず `_other` がある。
  - 値はすべて空でない文字列。各キーの `{{…}}` の名前の集まりが `en.json` の同じキー（複数形は `_other`）と同じ。
  - `ja.json`・`en.json` が上の表と一致する。
- サイドカー（テスト）: エラーが上の表のコード・英語の `error` で返る。入力エラーは `params` 付き。`not_owner_add` / `_edit` / `_delete`・`record_not_found`・`invalid_year` が出し分けられる。
- 画面（プレビューで確認）:
  - `ja` で v0.5 と同じ文言が出る（金額は `￥1,234` の形になる）。
  - `en`・`de` で文言・日付・金額が切り替わる。言語を変えると表示し直される。
  - `ar` で右から左になり、見出しの「追加」ボタン・数値の列・グラフが崩れない。375px 幅で横スクロールが出ない。
  - サーバーのエラー（例: 保有者が家族にいない）が選んだ言語で出る。
- `npm run lint` / `format:check` / `typecheck` / `test` / `build` が通る。

## 出力形式

指定された 1 ファイルの内容のみ。

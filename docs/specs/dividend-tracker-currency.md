# 仕様: 銘柄ごとの通貨 v0.5

記録（保有者 × 銘柄）ごとに通貨を持たせる。米国株はドル、欧州株はユーロのように、通貨ごとに 1株配当と受取額を記録する。
通貨をまたいだ換算はしない（為替レートを持たない）。合計・グラフは **通貨ごとに分けて** 出す。

前提: `docs/specs/dividend-tracker-logic.md` v0.4、`dividend-tracker-sidecar.md` v0.4、`dividend-tracker-ui.md` v0.7、`dividend-tracker-monthly-chart.md` v0.3。
この仕様に書いていないことは、それぞれの仕様のまま変えない。表示言語は日本語のまま（言語の切り替えは別の仕様で扱う）。

## 対象ファイル

| ファイル | 変更 |
| --- | --- |
| `src/logic.ts` | 通貨の型・定数、通貨ごとの解析・整形・集計、v0.4 データの移行 |
| `src/logic.test.ts` | 上のテスト |
| `server/store.ts` | 保存ファイルを version 4 にし、version 3 を移行する |
| `server/app.ts` | 本文の `currency` を受け取る |
| `server/app.test.ts`・`server/store.test.ts` | 上のテスト |
| `src/index.ts` | 通貨の選択、通貨ごとの表示、グラフの通貨切り替え |
| `modules/dividend-tracker/style.css` | 合計額を通貨ごとに並べる |
| `dev/mock-records.ts` | 初期データに通貨を付け、外国株の記録と年別合計を加える |
| `README.md`・`package.json`・`modules/dividend-tracker/module.json` | v0.5.0 |

## 通貨（`src/logic.ts`）

```ts
export const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'HKD', 'CNY', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];
```

- 並び順はこの配列の順（以下「通貨の順」）。集計結果・選択肢・表示はすべてこの順。
- 金額の単位:

| 通貨 | 受取額 `amount` の単位 | 1株配当 `perShareCents` の単位 | 1株配当の入力できる桁 |
| --- | --- | --- | --- |
| JPY | 1 円 | 1/100 円 | 小数第 2 位まで |
| JPY 以外 | 1/100（セント等） | 1/10000 | 小数第 4 位まで |

  - どちらも「`perShareCents` の単位 = `amount` の単位の 1/100」なので、`calcAmount(shares, perShareCents)`（`shares × perShareCents ÷ 100`、切り捨て、`BigInt`）は **v0.4 のまま全通貨で使う**。JPY は 1 円未満、JPY 以外は 1 セント未満を切り捨てることになる。
  - 項目名 `perShareCents` は互換のため変えない（JPY 以外では 1/10000 単位の意味になる。型のコメントに書く）。
  - `MAX_PER_SHARE_CENTS = 10_000_000` も変えない（JPY は 100,000 円、JPY 以外は 1,000 まで）。

## `src/logic.ts` の変更

### 型

- `DividendRecord` に `currency: Currency` を追加（`ticker` の前）。
- `RecordInput` に `currency: string` を追加（`ownerId` の後）。
- 追加: `export interface CurrencyBreakdown extends Breakdown { currency: Currency }`。
- `YearlyTotal` を次の形に変える（`Breakdown` を継承しない）:

```ts
export interface YearlyTotal {
  year: number;                 // MIN_YEAR〜MAX_YEAR
  totals: CurrencyBreakdown[];  // 通貨の順で重複なし。各 total は 1 以上（0 の通貨は含めない）。空配列は「0」
  registeredBy: number;
  registeredAt: string;
}
```

- `MonthlyTotal`・`YearlyBar` は v0.4 のまま（1 つの通貨の値）。

### 関数（変更・追加。すべて export）

1. `isCurrency(value: unknown): value is Currency` — `CURRENCIES` に含まれる文字列なら true。
2. `perShareDecimals(currency: Currency): number` — JPY は 2、それ以外は 4。
3. `parsePerShare(text: string, currency: Currency): number | null`
   - `^(\d+)(?:\.(\d{1,d}))?$`（d = `perShareDecimals(currency)`）に一致し、`整数部 × 10^d + 小数部（右を 0 で d 桁に）` が MAX_PER_SHARE_CENTS 以下ならその値。`BigInt` で組み立てる。浮動小数点演算は使わない。
   - 例: `('37.5', 'JPY')` → 3750、`('0.2475', 'USD')` → 2475、`('1', 'USD')` → 10000、`('0.123', 'JPY')` → null、`('0.12345', 'USD')` → null。
4. `validateInput(input)` — v0.4 の順に、保有者の判定の直後に通貨の判定を入れる:
   - `isCurrency(input.currency)` が false → `'通貨を選んでください'`。
   - 1株配当は `parsePerShare(perShareText, currency)`。null → `` `1株当たり配当は0以上、小数第${perShareDecimals(currency)}位までで入力してください` ``（JPY は v0.4 と同じ文言になる）。
5. `buildPayments(shares: number, inputs: PaymentInput[], currency: Currency): Payment[]` — `parsePerShare` に通貨を渡す以外は v0.4 と同じ。
6. `isValidRecord(value)` — v0.4 の条件に加えて `isCurrency(value.currency)`。
7. `migrateV4Record(value: unknown): DividendRecord | null`（新規）— v0.4 の `isValidRecord` の条件（通貨なし）を満たす記録に `currency: 'JPY'` を付けて返す（元に `currency` があっても `'JPY'` にする）。満たさなければ null。
8. `migrateV3Record`・`migrateLegacyRecord` — 返す記録に `currency: 'JPY'` を付ける。それ以外は v0.4 と同じ。
9. `annualTotals(records): CurrencyBreakdown[]` — 通貨ごとに v0.4 の集計（保有者ごとの `recordTotal` の和、0 の保有者を除く、`ownerId` 昇順）をする。total が 0 の通貨は含めない。通貨の順。記録が 0 件なら空配列。
10. `buildYearlyTotal(records, year, registeredBy, registeredAt): YearlyTotal` — `totals = annualTotals(records)`。
11. `isValidYearlyTotal(value)` — `year` の範囲、`registeredBy` が正の整数、`registeredAt` が文字列、`totals` が配列で、各要素の `currency` が通貨・通貨の順で厳密に増える（重複なし）・`owners` が v0.4 と同じ条件（正の整数の `ownerId` が厳密に昇順、`total` が 1 以上の整数）・`total` が `owners` の和で 1 以上。
12. `migrateV4YearlyTotal(value: unknown): YearlyTotal | null`（新規）— v0.4 の `isValidYearlyTotal` の条件（`{ year, total, owners, registeredBy, registeredAt }`）を満たせば、`totals` を `total > 0` なら `[{ currency: 'JPY', total, owners }]`、0 なら `[]` にして返す。満たさなければ null。
13. `monthlyTotals(records, currency: Currency): MonthlyTotal[]` — その通貨の記録だけを集計する。それ以外は v0.4 と同じ。
14. `yearlyChart(totals, endYear, ownerId, currency: Currency): YearlyBar[]` — 各年の `totals` のうちその通貨の内訳を使う。無ければ 0。それ以外は v0.4 と同じ。
15. `usedCurrencies(records: DividendRecord[], totals: YearlyTotal[]): Currency[]`（新規）— 記録の `currency` と、年別合計の `totals` の `currency` に出てくる通貨を、重複なく通貨の順で返す。
16. `formatAmount(amount: number, currency: Currency): string`（新規。`formatYen` を置き換え、`formatYen` は削除する）
    - JPY: 3 桁区切り + `円`（`1,234円`。v0.4 の `formatYen` と同じ）。
    - それ以外: `<通貨コード> <整数部を 3 桁区切り>.<小数部 2 桁>`。`amount` は 1/100 単位の整数（`(123456, 'USD')` → `USD 1,234.56`、`(5, 'USD')` → `USD 0.05`、`(0, 'EUR')` → `EUR 0.00`）。文字列操作で組み立て、浮動小数点演算を使わない。
17. `perShareInputText(perShareCents: number, currency: Currency): string`（新規）— 1株配当を入力欄用の文字列に戻す。小数部は `perShareDecimals` 桁で、末尾の 0 と、小数部が無くなったときの `.` を取る。3 桁区切りや通貨は付けない。
    - `(3750, 'JPY')` → `37.5`、`(5, 'JPY')` → `0.05`、`(1200, 'JPY')` → `12`、`(2475, 'USD')` → `0.2475`、`(10000, 'USD')` → `1`、`(2600, 'USD')` → `0.26`。
18. `formatPerShare(perShareCents, currency: Currency): string` — JPY は `perShareInputText` の整数部を 3 桁区切りにして `円`（v0.4 と同じ表示、`37.5円`）。それ以外は `<通貨コード> <整数部を 3 桁区切り>[.<小数部>]`（`USD 0.2475`、`USD 1`）。

`parseShares`・`calcAmount`・`isValidDate`・`isValidPayDate`・`parseRecords`・`filterByOwner`・`recordTotal`・`parseYear`・`sortForList` は v0.4 のまま。

## サイドカー（`server/`）

- POST / PUT の本文に `currency` を追加する。
  - **省略されたら `'JPY'`** として扱う（v0.4 の画面のまま、サイドカーだけ更新された場合でも保存できるように）。
  - 文字列でなければ 400 `'データの形式が正しくありません'`（`bad_request`）。
  - 文字列なら `validateInput` に渡す（通貨でなければ 400 `'通貨を選んでください'`）。
- 保存する記録: `currency` は入力の値。`payments = buildPayments(shares, input.payments, currency)`。他は v0.4 と同じ。
- 年別合計の登録（`PUT /yearly-totals/<year>`）は v0.4 と同じ（`buildYearlyTotal` が通貨ごとに作る）。
- 保存ファイル（`store.ts`）:
  - `{ "version": 4, "records": [...], "yearlyTotals": [...] }`。
  - version 4: `isValidRecord`・`isValidYearlyTotal` を満たすものだけ使う（同じ年は後のもの）。
  - version 3: 記録は `migrateV4Record`、年別合計は `migrateV4YearlyTotal` で変換し、null でないものだけ使う（同じ年は後のもの）。
  - version 2・1: v0.4 と同じ（`migrateV3Record`・`migrateLegacyRecord`。どちらも JPY になる）。年別合計は空。
  - それ以外の version は v0.4 と同じく起動を失敗させる。次の書き込みで version 4 になる。

## 画面（`src/index.ts`）

### 状態

- 追加: `chartCurrency: Currency`（グラフに出す通貨。既定 `'JPY'`）。

### ダイアログ

- 2 段目の右の列に `label`「通貨」+ `select[name=currency]` を置く（左は保有株数のまま）。保有株数を左の列に固定していた `dt-field--shares`（クラスと CSS）は不要になるので削除する。
  - 選択肢は通貨の順に、value が通貨コード、表示が下の「通貨の表示名」。
  - 初期値は新規なら `JPY`、編集なら記録の `currency`。
- 1株配当の欄の見出しを「1株当たり配当」にする（「（円）」を外す）。
- 編集時の1株配当は `perShareInputText(perShareCents, record.currency)`（`src/index.ts` の `perShareText` は削除する）。
- `readForm` は `currency: <select[name=currency] の値>` を入れる。

通貨の表示名（`src/index.ts` に定数で持つ）:

| コード | 表示 |
| --- | --- |
| JPY | 円（JPY） |
| USD | 米ドル（USD） |
| EUR | ユーロ（EUR） |
| GBP | 英ポンド（GBP） |
| AUD | 豪ドル（AUD） |
| CAD | カナダドル（CAD） |
| CHF | スイスフラン（CHF） |
| HKD | 香港ドル（HKD） |
| CNY | 人民元（CNY） |
| SGD | シンガポールドル（SGD） |

### 銘柄一覧

- 「合計」の列は `formatAmount(recordTotal(record), record.currency)`。列は増やさない。

### 合計額

- `annualTotals(filterByOwner(records, filter))` の通貨ごとに `p.dt-total` を 1 つずつ（通貨の順）。`formatAmount(total, currency)`。
- 1 つも無ければ `p.dt-total`「0円」を 1 つ。
- 複数の `p.dt-total` は `div.dt-totals` で包む（1 つでも包む）。
- 年別合計の登録欄・メッセージは v0.7 のまま。ただし金額の文言は、`totals` の各通貨の `formatAmount` を `、` でつないだもの（空なら `0円`）。
  - 確認: `<年>年の配当合計は登録済みです（1,234円、USD 56.78）。現在の合計額で置き換えますか？`
  - 結果: `<年>年の配当合計を登録しました（1,234円、USD 56.78）`

### グラフ（月別・年別）

- グラフに出す通貨の候補は `usedCurrencies(records, yearlyTotals)`（保有者フィルタに関係なく全記録から。フィルタで候補が変わらないように）。
- `draw()` のたびに、`chartCurrency` が候補に無く、候補が 1 つ以上あれば、候補の先頭にする。
- 候補が 2 つ以上のときだけ、「月別配当額」の見出し行を `div.dt-heading` にし、`h2` の右に `label.dt-filter`「通貨」+ `select[name=chartCurrency]`（候補を通貨の表示名で、値は `chartCurrency`）を置く。この選択は月別・年別の両方に効く。
  - `change` で `chartCurrency` を更新して `draw()`。
- 月別: `monthlyTotals(filterByOwner(records, filter), chartCurrency)`。対象（保有者で絞った記録）が 0 件なら v0.3 と同じく「まだ記録がありません」。
- 年別: `yearlyChart(yearlyTotals, endYear, filter, chartCurrency)`。
- グラフの値・`aria-label`・ツールチップ・凡例の金額は `formatAmount(<金額>, chartCurrency)`。
- 棒の高さの比率・色・ツールチップの動作は v0.3 のまま。

## スタイル（`modules/dividend-tracker/style.css`）

- `.dt-totals`: `p.dt-total` を縦に並べる（`display: grid`、間隔 `--space-1`）。`.dt-totals .dt-total` は上の余白なし。`.dt-totals` の上の余白は v0.7 の `.dt-total` と同じ。
- ダイアログの通貨の欄は、ほかの入力欄と同じ見た目（既存の `.dt-form select`）。

## 画面確認用のモック（`dev/mock-records.ts`）

- 既存の初期データはすべて `currency: 'JPY'`。
- 外国株の記録を 1 件追加: 保有者 1、`AAPL`、`Apple`、50 株、`USD`、受取日 `02-13`・`05-15`・`08-14`・`11-13`、1株配当 `0.26`（どれも同じ）。
- 年別合計の初期データは JPY のほか、2 年前と 1 年前に保有者 1 の USD（それぞれ `4800`・`5200`、1/100 ドル単位）を入れる。
- POST / PUT は本文の `currency`（省略時 `JPY`）を `validateInput`・`buildPayments` に渡す。

## 受け入れ条件（テスト）

- logic:
  - `isCurrency`: `'JPY'`・`'USD'` が true、`'jpy'`・`'XYZ'`・`''`・`1` が false。
  - `parsePerShare`: JPY は v0.4 のテストがそのまま通る（第 2 引数 `'JPY'`）。USD は `'0.2475'` → 2475、`'1'` → 10000、`'1000'` → 10_000_000、`'1000.0001'` → null、`'0.12345'` → null。
  - `calcAmount(3, 2475)` → 74（USD 0.7425 → 1 セント未満切り捨てで USD 0.74）。
  - `validateInput`: 通貨が不正 → `'通貨を選んでください'`。USD で `'0.12345'` → `'1株当たり配当は0以上、小数第4位までで入力してください'`、JPY で `'0.123'` → 小数第2位の文言。
  - `buildPayments(50, [{ payDate: '02-13', perShareText: '0.26' }], 'USD')` → `[{ payDate: '02-13', perShareCents: 2600, amount: 1300 }]`。
  - `isValidRecord`: 通貨なし・不正な通貨を拒否する。
  - `migrateV4Record`: v0.4 の正しい記録に JPY を付ける。不正な記録に null。`migrateV3Record`・`migrateLegacyRecord` の結果が JPY。
  - `annualTotals`: 通貨ごとに分かれ、通貨の順、0 の通貨を含まない、記録 0 件で空。
  - `isValidYearlyTotal`: 正しい形を受け入れ、通貨の重複・順の逆転・不正な通貨・和の食い違い・total 0 の通貨・v0.4 の形を拒否する。
  - `migrateV4YearlyTotal`: total > 0 は JPY 1 件、total 0 は空配列。不正なら null。
  - `monthlyTotals`・`yearlyChart`: 指定した通貨だけを集計する。
  - `usedCurrencies`: 記録と年別合計の両方から、重複なく通貨の順。
  - `formatAmount`・`perShareInputText`・`formatPerShare`: 上の例のとおり。JPY の表示は v0.4 と同じ。
- サイドカー:
  - POST で `currency` を省略すると JPY で保存される。`'USD'` で保存すると amount が 1 セント単位で計算される。`currency` が数値なら 400 `bad_request`、`'XYZ'` なら 400 `'通貨を選んでください'`。
  - PUT で通貨を変えられる（amount が新しい通貨の桁で計算し直される）。
  - 年別合計の登録が通貨ごとの `totals` を返す。
  - store: version 3 のファイル（記録と年別合計）を移行して読み込み、書き込み後は version 4 になる。version 1・2 も読み込める。
- 画面（プレビューで確認）: ダイアログで通貨を選んで保存でき、一覧の合計がその通貨で出る。合計額が通貨ごとに並ぶ。通貨が 2 つ以上あるとき通貨の選択が出て、月別・年別のグラフが切り替わる。JPY だけのときは通貨の選択が出ず、v0.4 と同じ見た目。375px 幅で横スクロールが出ない。
- `npm run lint` / `format:check` / `typecheck` / `test` / `build` が通る。

## 出力形式

指定された 1 ファイルの内容のみ。

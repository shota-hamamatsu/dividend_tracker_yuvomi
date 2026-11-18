# 仕様: 配当計算ロジック（src/logic.ts）v0.4

DOM・localStorage・fetch・Node 固有 API に一切依存しない純粋関数だけを書く。TypeScript（strict）。
`enum` / `namespace` / デコレータ / パラメータプロパティは使わない。外部 import なし。
画面（`src/index.ts`）とサイドカー（`server/`）の両方から import する。

v0.3 の変更点: 1 つの記録（保有者 × 銘柄）に **受取日を複数** 持たせる。受取日ごとに 1株当たり配当が異なる。
保有株数は記録に 1 つ（全受取日で共通）。

v0.4 の変更点:
- 受取日を **月日だけ**（`MM-DD`）にする。記録は「毎年この月日にこの額を受け取る」という意味になる。
- 年ごとの配当合計は記録から計算せず、利用者が年を指定して **登録** したもの（`YearlyTotal`）を使う。登録時点の記録の合計を保存する。
- `yearlyTotals` を削除し、`annualTotals`・`buildYearlyTotal`・`isValidYearlyTotal`・`yearlyChart`・`parseYear` を追加する。
- v0.3 形式（`YYYY-MM-DD`）の記録を v0.4 形式に変換する `migrateV3Record` を追加する。

## 定数

- `MAX_SHARES = 10_000_000`
- `MAX_PER_SHARE_CENTS = 10_000_000`（= 100,000 円）
- `MAX_PAYMENTS = 24`（1 記録あたりの受取日の上限）。export する。
- `MIN_YEAR = 2000`、`MAX_YEAR = 2100`（登録できる年の範囲）。export する。
- `CHART_YEARS = 12`（年別グラフに出す年数）。export する。

## 型

```ts
export interface Payment {
  payDate: string;       // MM-DD（うるう年に実在する月日。02-29 も可）
  perShareCents: number; // 1株当たり配当を 1/100 円単位の整数で。0 以上 MAX_PER_SHARE_CENTS 以下
  amount: number;        // 受取額（円）= calcAmount(record.shares, perShareCents)
}

export interface DividendRecord {
  id: string;
  ownerId: number;       // 株を保有している yuvomi ユーザーの id（正の整数）
  ticker: string;        // 空でない
  name: string;          // 空でもよい
  shares: number;        // 保有株数。1 以上 MAX_SHARES 以下の整数
  payments: Payment[];   // 1 件以上 MAX_PAYMENTS 件以下。payDate の昇順で、重複なし
  createdBy: number;     // 記録したユーザーの id（正の整数）
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601（最後に保存した日時。新規作成時は createdAt と同じ）
}

export interface PaymentInput {
  payDate: string;       // MM-DD
  perShareText: string;
}

export interface RecordInput {
  ownerId: number;
  ticker: string;
  name: string;
  sharesText: string;
  payments: PaymentInput[];
}

export interface OwnerTotal {
  ownerId: number;
  total: number;         // 円。1 以上
}

export interface YearlyTotal {
  year: number;          // MIN_YEAR 以上 MAX_YEAR 以下の整数
  total: number;         // 円。owners の total の和（保有者が 0 人なら 0）
  owners: OwnerTotal[];  // ownerId の厳密な昇順。0 円の保有者は含めない
  registeredBy: number;  // 登録したユーザーの id（正の整数）
  registeredAt: string;  // ISO 8601
}
```

## 関数（すべて export）

1. `parseShares(text: string): number | null` — v0.3 と同じ。
2. `parsePerShare(text: string): number | null` — v0.3 と同じ（`BigInt` で組み立てる。浮動小数点演算を使わない）。
3. `calcAmount(shares: number, perShareCents: number): number` — v0.3 と同じ（1円未満切り捨て、`BigInt`）。
4. `isValidDate(text: string): boolean` — v0.3 と同じ（`YYYY-MM-DD`）。移行でだけ使う。
5. `isValidPayDate(text: string): boolean`（新規）
   - `^\d{2}-\d{2}$` に一致し、うるう年（2000 年）に実在する月日なら true（`'02-29'` は true、`'02-30'`・`'13-01'`・`'6-30'` は false）。
6. `validateInput(input: RecordInput): string | null` — v0.3 と同じ順で判定する。変更点:
   - 受取日の判定は `isValidPayDate(payDate)`。false → `'受取日を正しく選んでください'`。
7. `buildPayments(shares, inputs)` — v0.3 と同じ（`payDate` の昇順）。
8. `isValidRecord(value)` — v0.3 と同じ。ただし `payDate` は `isValidPayDate`。
9. `migrateV3Record(value: unknown): DividendRecord | null`（新規）
   - v0.3 形式（`payDate` が `YYYY-MM-DD`、それ以外は v0.4 と同じ項目）を v0.4 形式にする。v0.3 の条件（`isValidDate`、amount の一致、昇順など）を満たさなければ `null`。
   - 各 payment の `payDate` を月日（`MM-DD`）だけにする。同じ月日が複数あれば **最も新しい年** のものを残す。結果は月日の昇順。
10. `migrateLegacyRecord(value: unknown): DividendRecord | null` — v0.2 形式を **v0.4 形式** にする（`payments = [{ payDate: 月日, perShareCents, amount }]`、`updatedAt = createdAt`）。不正なら `null`。
11. `parseRecords(json)` — v0.3 と同じ。
12. `filterByOwner(records, ownerId)` — v0.3 と同じ。
13. `recordTotal(record)` — v0.3 と同じ（1 年分の受取額）。
14. `annualTotals(records: DividendRecord[]): { total: number; owners: OwnerTotal[] }`（新規）
    - 全記録の `recordTotal` を保有者ごとに合計する。`owners` は `ownerId` の昇順、0 円の保有者を含めない。`total` は `owners` の和。
15. `buildYearlyTotal(records, year: number, registeredBy: number, registeredAt: string): YearlyTotal`（新規）
    - `annualTotals(records)` の結果に `year`・`registeredBy`・`registeredAt` を付ける。
16. `isValidYearlyTotal(value: unknown): value is YearlyTotal`（新規）
    - 型の各項目の条件を満たすこと（`year` の範囲、`owners` の各要素が正の整数の `ownerId` と 1 以上の整数の `total`、`ownerId` が厳密に昇順、`total` が和と一致、`registeredBy` が正の整数、`registeredAt` が文字列）。
17. `parseYear(text: string): number | null`（新規）
    - `^\d{4}$` に一致し、MIN_YEAR 以上 MAX_YEAR 以下ならその整数。それ以外は `null`。
18. `monthlyTotals(records: DividendRecord[]): MonthlyTotal[]` — 引数から年を外す。
    - 長さ 12。各月の `total` はその月（`payDate` の先頭 2 文字）の payments の `amount` の合計。`owners` は v0.3 と同じ（`ownerId` 昇順、0 円を含めない、和が `total`）。
19. `yearlyChart(totals: YearlyTotal[], endYear: number, ownerId: number | null): { year: number; total: number; owners: OwnerTotal[] }[]`（新規）
    - `endYear - CHART_YEARS + 1` から `endYear` までの CHART_YEARS 件を年の昇順で返す。
    - 登録の無い年は `total: 0, owners: []`。
    - `ownerId` が null でなければ、`owners` をその保有者だけにし、`total` をその保有者の額にする（いなければ 0）。
20. `sortForList(records)` — v0.3 と同じ。
21. `formatYen(amount)` / `formatPerShare(cents)` — v0.3 と同じ。

`yearlyTotals`（受取日の年での集計）は削除する。

## 受け入れ条件（テスト）

- v0.3 の `calcAmount`・`parsePerShare`・`formatYen`・`formatPerShare`・`isValidDate`・`sortForList` のテストがそのまま通る。
- `isValidPayDate`: `'02-29'`・`'12-31'` が true、`'02-30'`・`'00-10'`・`'13-01'`・`'6-30'`・`'2025-06-30'` が false。
- `validateInput` の各メッセージが出る（受取日 0 件・25 件・不正な月日・不正な1株配当・重複を含む）。
- `buildPayments(3, [{ payDate: '09-30', perShareText: '37.5' }, { payDate: '03-31', perShareText: '40' }])` が
  `[{ payDate: '03-31', perShareCents: 4000, amount: 120 }, { payDate: '09-30', perShareCents: 3750, amount: 112 }]`。
- `isValidRecord` が amount の食い違い・payments 0 件・日付の重複・降順・年付きの日付を拒否する。
- `migrateV3Record` が年を外し、同じ月日は新しい年のものを残し、月日の昇順にする。不正な記録に `null`。
- `migrateLegacyRecord` が v0.2 の正しい記録を v0.4 形式に変換し、amount が食い違う記録や欠けた記録に `null` を返す。
- `annualTotals` / `buildYearlyTotal` が保有者ごとに合算し、0 円の保有者を含めない。
- `isValidYearlyTotal` が和の食い違い・範囲外の年・昇順でない owners・0 円の保有者を拒否する。
- `parseYear` の範囲と形式。
- `monthlyTotals` が月日で振り分ける。`yearlyChart` が 12 年分を昇順で返し、保有者で絞り込める。

## 出力形式

`src/logic.ts` の内容のみ。

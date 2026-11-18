# 仕様: 配当計算ロジック（src/logic.ts）v0.3

DOM・localStorage・fetch・Node 固有 API に一切依存しない純粋関数だけを書く。TypeScript（strict）。
`enum` / `namespace` / デコレータ / パラメータプロパティは使わない。外部 import なし。
画面（`src/index.ts`）とサイドカー（`server/`）の両方から import する。

v0.3 の変更点: 1 つの記録（保有者 × 銘柄）に **受取日を複数** 持たせる。受取日ごとに 1株当たり配当が異なる。
保有株数は記録に 1 つ（全受取日で共通）。

## 定数

- `MAX_SHARES = 10_000_000`
- `MAX_PER_SHARE_CENTS = 10_000_000`（= 100,000 円）
- `MAX_PAYMENTS = 24`（1 記録あたりの受取日の上限）。export する。

## 型

```ts
export interface Payment {
  payDate: string;       // YYYY-MM-DD（実在する日付）
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
  payDate: string;
  perShareText: string;
}

export interface RecordInput {
  ownerId: number;
  ticker: string;
  name: string;
  sharesText: string;
  payments: PaymentInput[];
}
```

## 関数（すべて export）

1. `parseShares(text: string): number | null` — v0.2 と同じ。
   `^[1-9]\d*$` に一致し、MAX_SHARES 以下ならその整数。それ以外は `null`。

2. `parsePerShare(text: string): number | null` — v0.2 と同じ。
   `^\d+(\.\d{1,2})?$` に一致する文字列を 1/100 円単位の整数にする（`'37.5'` → `3750`、`'0.05'` → `5`、`'12'` → `1200`）。
   浮動小数点演算を使わず、文字列の整数部と小数部から `BigInt` で組み立てる。MAX_PER_SHARE_CENTS を超えたら `null`。不一致も `null`。

3. `calcAmount(shares: number, perShareCents: number): number` — v0.2 と同じ。
   `shares × perShareCents ÷ 100` の **1円未満切り捨て**。`BigInt` で計算して `number` に戻す。

4. `isValidDate(text: string): boolean` — v0.2 と同じ。

5. `validateInput(input: RecordInput): string | null`
   問題なければ `null`、あれば次の日本語メッセージ（上から順に判定し、最初に該当したものを返す）:
   - `ownerId` が正の整数でない → `'保有者を選んでください'`
   - `ticker.trim()` が空 → `'銘柄コードを入力してください'`
   - `parseShares(sharesText)` が null → `'保有株数は1以上の整数で入力してください'`
   - `payments` が 0 件 → `'受取日を1つ以上入力してください'`
   - `payments` が MAX_PAYMENTS 件を超える → `'受取日は24件までです'`
   - `payments` を先頭から順に見て、
     - `isValidDate(payDate)` が false → `'受取日を入力してください'`
     - `parsePerShare(perShareText)` が null → `'1株当たり配当は0以上、小数第2位までで入力してください'`
   - 同じ `payDate` が 2 回以上ある → `'同じ受取日が重複しています'`

6. `buildPayments(shares: number, inputs: PaymentInput[]): Payment[]`
   - `validateInput` を通った入力を前提とする。各要素を `{ payDate, perShareCents: parsePerShare(perShareText), amount: calcAmount(shares, perShareCents) }` にし、`payDate` の昇順に並べた新しい配列を返す。

7. `isValidRecord(value: unknown): value is DividendRecord`
   - 型の各項目の条件を満たすこと。`payments` は配列で 1〜MAX_PAYMENTS 件、各要素の `payDate` が実在する日付、
     `perShareCents` が範囲内の整数、`amount === calcAmount(shares, perShareCents)`、`payDate` が厳密に昇順（重複なし）。

8. `migrateLegacyRecord(value: unknown): DividendRecord | null`
   - v0.2 形式 `{ id, ownerId, ticker, name, payDate, shares, perShareCents, amount, createdBy, createdAt }` を v0.3 形式に変換する。
   - v0.2 の条件（各項目の型・範囲、`amount === calcAmount(shares, perShareCents)`）を満たさなければ `null`。
   - 変換結果: `payments = [{ payDate, perShareCents, amount }]`、`updatedAt = createdAt`。それ以外の項目はそのまま。

9. `parseRecords(json: string | null): DividendRecord[]`
   - null・不正な JSON・配列でない場合は `[]`。`isValidRecord` を満たす要素だけ返す。

10. `filterByOwner(records: DividendRecord[], ownerId: number | null): DividendRecord[]` — v0.2 と同じ。

11. `recordTotal(record: DividendRecord): number`
    - `payments` の `amount` の合計（円）。

12. `yearlyTotals(records: DividendRecord[]): { year: string; total: number }[]`
    - すべての記録の **すべての payments** を `payDate` の先頭 4 文字（年）で集計し、年の降順で返す。

13. `sortForList(records: DividendRecord[]): DividendRecord[]`
    - 一覧表示用。`ticker` の昇順（文字列比較）、同じなら `ownerId` の昇順、さらに同じなら `id` の昇順。新しい配列を返す。
    - v0.2 の `sortByPayDateDesc` は削除する（記録に `payDate` が無くなるため）。

14. `formatYen(amount: number): string` / `formatPerShare(cents: number): string` — v0.2 と同じ。
    - `formatYen`: 3 桁区切り + `円`（`1234567` → `'1,234,567円'`）。
    - `formatPerShare`: `3750` → `'37.5円'`、`5` → `'0.05円'`、`120000` → `'1,200円'`、`0` → `'0円'`。

## 受け入れ条件（テスト）

- v0.2 の `calcAmount`・`parsePerShare`・`formatYen`・`formatPerShare`・`isValidDate` のテストがそのまま通る。
- `validateInput` の各メッセージが出る（受取日 0 件・25 件・不正な日付・不正な1株配当・重複を含む）。
- `buildPayments(3, [{ payDate: '2025-09-30', perShareText: '37.5' }, { payDate: '2025-03-31', perShareText: '40' }])` が
  `[{ payDate: '2025-03-31', perShareCents: 4000, amount: 120 }, { payDate: '2025-09-30', perShareCents: 3750, amount: 112 }]`。
- `isValidRecord` が amount の食い違い・payments 0 件・日付の重複・降順を拒否する。
- `migrateLegacyRecord` が v0.2 の正しい記録を変換し、amount が食い違う記録や欠けた記録に `null` を返す。
- `yearlyTotals` が 1 記録内の複数年の payments をそれぞれの年に振り分ける。`recordTotal` が合計を返す。
- `sortForList` の並び順。

## 出力形式

`src/logic.ts` の内容のみ。

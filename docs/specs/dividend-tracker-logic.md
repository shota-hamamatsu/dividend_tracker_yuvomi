# 仕様: 配当計算ロジック（src/logic.ts）v0.2

DOM・localStorage・fetch・Node 固有 API に一切依存しない純粋関数だけを書く。TypeScript（strict）。
`enum` / `namespace` / デコレータ / パラメータプロパティは使わない。外部 import なし。
画面（`src/index.ts`）とサイドカー（`server/`）の両方から import する。

## 型

```ts
export interface DividendRecord {
  id: string;
  ownerId: number;      // 株を保有している yuvomi ユーザーの id（正の整数）
  ticker: string;       // 空でない
  name: string;         // 空でもよい
  payDate: string;      // YYYY-MM-DD（実在する日付）
  shares: number;       // 保有株数。1 以上 10,000,000 以下の整数
  perShareCents: number;// 1株当たり配当を 1/100 円単位の整数で。0 以上 10,000,000 以下
  amount: number;       // 受取額（円）= calcAmount(shares, perShareCents)
  createdBy: number;    // 記録したユーザーの id（正の整数）
  createdAt: string;    // ISO 8601
}

export interface RecordInput {
  ownerId: number;
  ticker: string;
  name: string;
  payDate: string;
  sharesText: string;
  perShareText: string;
}
```

## 関数（すべて export）

1. `parseShares(text: string): number | null`
   - `^[1-9]\d*$` に一致し、10,000,000 以下ならその整数。それ以外は `null`。

2. `parsePerShare(text: string): number | null`
   - `^\d+(\.\d{1,2})?$` に一致する文字列を 1/100 円単位の整数にする（`'37.5'` → `3750`、`'0.05'` → `5`、`'12'` → `1200`）。
   - 浮動小数点演算を使わず、文字列の整数部と小数部から組み立てる。
   - 10,000,000（=100,000円）を超えたら `null`。不一致も `null`。

3. `calcAmount(shares: number, perShareCents: number): number`
   - `shares × perShareCents ÷ 100` の **1円未満切り捨て**。`BigInt` で計算して `number` に戻す。

4. `isValidDate(text: string): boolean`
   - `^\d{4}-\d{2}-\d{2}$` に一致し、かつ実在する日付（`2025-02-30` は false、`2024-02-29` は true）。

5. `validateInput(input: RecordInput): string | null`
   - 問題なければ `null`、あれば次の日本語メッセージ（上から順に判定）:
     - `ownerId` が正の整数でない → `'保有者を選んでください'`
     - `ticker.trim()` が空 → `'銘柄コードを入力してください'`
     - `isValidDate(payDate)` が false → `'受取日を入力してください'`
     - `parseShares(sharesText)` が null → `'保有株数は1以上の整数で入力してください'`
     - `parsePerShare(perShareText)` が null → `'1株当たり配当は0以上、小数第2位までで入力してください'`

6. `isValidRecord(value: unknown): value is DividendRecord`
   - 型の各項目の条件を満たし、かつ `amount === calcAmount(shares, perShareCents)`。

7. `parseRecords(json: string | null): DividendRecord[]`
   - null・不正な JSON・配列でない場合は `[]`。`isValidRecord` を満たす要素だけ返す。

8. `filterByOwner(records: DividendRecord[], ownerId: number | null): DividendRecord[]`
   - `null` なら全件（新しい配列）、それ以外は `ownerId` が一致するものだけ。

9. `yearlyTotals(records)` / `sortByPayDateDesc(records)` / `formatYen(amount)`: v0.1 と同じ動作。

10. `formatPerShare(cents: number): string`
    - 円に直して 3 桁区切り、小数部は末尾の 0 を除いて表示 + `円`。
    - `3750` → `'37.5円'`、`5` → `'0.05円'`、`120000` → `'1,200円'`、`0` → `'0円'`。

`newId` は削除する（id はサイドカーが `crypto.randomUUID()` で採番する）。

## 受け入れ条件（テスト）

- `calcAmount(3, 3750) === 112`（112.5 を切り捨て）、`calcAmount(100, 3750) === 3750`、`calcAmount(10_000_000, 10_000_000) === 1_000_000_000_000`。
- `parsePerShare` が `'1.234'`・`'-1'`・`'1e3'`・`''`・`' 1'`・`'.5'` を拒否する。
- `validateInput` の各メッセージが出る。
- `isValidRecord` が amount の食い違いを拒否する。

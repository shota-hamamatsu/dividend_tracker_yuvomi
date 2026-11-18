# 仕様: 配当計算ロジック（src/logic.ts）

DOM・localStorage・fetch に一切依存しない純粋関数だけを書く。TypeScript（strict）。
`enum` / `namespace` / デコレータ / パラメータプロパティは使わない。外部 import なし。

## 型

```ts
export interface DividendRecord {
  id: string;
  ticker: string;
  name: string;
  payDate: string; // YYYY-MM-DD
  amount: number;  // 円。0 以上の整数
}
```

## 関数（すべて export）

1. `isValidRecord(value: unknown): value is DividendRecord`
   - オブジェクトで、`id`・`ticker`・`name`・`payDate` が string、`amount` が number。
   - `ticker` は空でない。`payDate` は `^\d{4}-\d{2}-\d{2}$`。`amount` は有限で 0 以上の整数。

2. `parseRecords(json: string | null): DividendRecord[]`
   - null・不正な JSON・配列でない場合は `[]`。
   - 配列の要素のうち `isValidRecord` を満たすものだけ返す。

3. `validateInput(input: { ticker: string; payDate: string; amountText: string }): string | null`
   - 問題なければ `null`、あれば日本語のエラーメッセージを返す。
   - ticker を trim して空 → `'銘柄コードを入力してください'`
   - payDate が `^\d{4}-\d{2}-\d{2}$` でない → `'受取日を入力してください'`
   - amountText が空、または 0 以上の整数として解釈できない（小数・負数・数字以外）→ `'受取額は0以上の整数で入力してください'`

4. `yearlyTotals(records: DividendRecord[]): { year: string; total: number }[]`
   - 受取日の先頭 4 文字を年として合計する。年の新しい順（降順）。空配列なら `[]`。

5. `sortByPayDateDesc(records: DividendRecord[]): DividendRecord[]`
   - 元の配列を変更せず、受取日の新しい順（同日は元の順序を保つ）の新しい配列を返す。

6. `formatYen(amount: number): string`
   - 3 桁区切り + `円`。例: `1234567` → `'1,234,567円'`。`toLocaleString` は使わず自前で区切る（環境差を避けるため）。

7. `newId(): string`
   - `crypto.randomUUID()` が使えればそれ、なければ現在時刻とランダム値から作る。

## 出力形式
`src/logic.ts` の内容のみ。説明文やコードフェンスは不要。

# 仕様: 月別配当額の棒グラフ v0.1

画面の一番下に、選んだ年の月ごとの配当額（受取額の合計）を棒グラフで表示する。
前提: `docs/specs/dividend-tracker-logic.md` v0.3、`docs/specs/dividend-tracker-ui.md` v0.3。
外部ライブラリ・外部 URL・canvas・SVG は使わない（HTML 要素と CSS だけで描く）。`innerHTML` / `outerHTML` という語は書かない。

## 対象ファイル

| ファイル | 変更 |
| --- | --- |
| `src/logic.ts` | `monthlyTotals` を追加 |
| `src/logic.test.ts` | `monthlyTotals` のテストを追加 |
| `src/index.ts` | 「月別配当額」セクションを追加 |
| `modules/dividend-tracker/style.css` | グラフのスタイルを追加 |

## `src/logic.ts`

```ts
export function monthlyTotals(
  records: DividendRecord[],
  year: string, // 'YYYY'
): { month: number; total: number }[]
```

- 長さ 12 の配列を返す。`month` は 1〜12 の昇順。`total` はその年・その月に `payDate` がある payments の `amount` の合計（円）。該当が無い月は 0。
- 年月は `payDate` の文字列（`YYYY-MM`）で判定する（`Date` を使わない）。
- 引数の配列は変更しない。

## `src/index.ts`

- 状態に `chartYear: string | null` を追加（null = 既定の年）。
- 本文の **一番下**（銘柄一覧の後）に `section.page-section` を追加:
  - 見出し `h2`「月別配当額」。
  - 対象は `filterByOwner(records, filter)`（年間配当合計・銘柄一覧と同じ保有者フィルタに従う）。
  - 年の候補は `yearlyTotals(対象).map((t) => t.year)`（降順）。0 件なら `p`「まだ記録がありません」だけを表示する。
  - 年の選択 `label`「年」+ `select[name=chartYear]`。選ばれる年は、`chartYear` が候補にあればそれ、無ければ今年（端末のローカル時刻の年）が候補にあれば今年、それも無ければ候補の先頭。
  - グラフ `ol.dt-chart`（`aria-label="<年>年の月別配当額"`）に `monthlyTotals(対象, 年)` の 12 か月分の `li.dt-chart__month`。各 `li`:
    - `title` と `aria-label` に `1月: 4,500円`（`formatYen`）。
    - 子要素（上から）: `span.dt-chart__value`（`formatYen(total)`。0 円の月は空文字）、`div.dt-chart__track` > `div.dt-chart__bar`、`span.dt-chart__label`（`1月`〜`12月`）。
    - 棒の高さは `style.height = (total / その年の月の最大値 × 100) + '%'`。最大値が 0 なら全月 `0%`。表示用の計算なので金額には使わない。
- `change` リスナー: 対象が `select[name=chartYear]` なら `chartYear` を更新して `draw()`。
- 保有者フィルタを変えて選択中の年が候補から消えた場合は、上の規則で選び直す（`chartYear` はそのまま残してよい）。

## `modules/dividend-tracker/style.css`

- `.dt-chart`: リストの記号・余白なし。12 列の grid（`repeat(12, minmax(0, 1fr))`）、列間 `--space-1`、高さ 12rem 程度、下揃え。
- `.dt-chart__month`: 縦並び（値・棒・月名）。
- `.dt-chart__track`: 残りの高さを占め、棒を下揃えにする。
- `.dt-chart__bar`: 背景 `--color-btn-primary`、上の角を丸める。0% のときは見えなくてよい。
- `.dt-chart__value`: `--type-caption`、`tabular-nums`、中央揃え。幅 40rem 未満の画面では非表示（`title` と `aria-label` で金額が分かる）。
- `.dt-chart__label`: `--type-caption`、`--color-text-secondary`、中央揃え。

## 受け入れ条件

- `monthlyTotals`: 12 件・1〜12 月、同じ月の複数記録・同じ記録内の同じ月以外の payments が正しく振り分けられる、他の年は含まない、0 件の年は全月 0。
- 画面: 保有者フィルタ・年の選択でグラフが変わる。12 か月の棒が並び、最大の月が 100%。375px 幅でも横スクロールが出ない。
- `npm run lint` / `format:check` / `typecheck` / `test` / `build` が通る。

## 出力形式

指定された 1 ファイルの内容のみ。

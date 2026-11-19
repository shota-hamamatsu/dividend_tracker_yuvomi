# 仕様: 月別・年別配当額の棒グラフ v0.3

合計額の下に月ごとの配当額（受取額の合計）を、その下に登録した年ごとの配当合計を、それぞれ棒グラフで表示する。
前提: `docs/specs/dividend-tracker-logic.md` v0.4、`docs/specs/dividend-tracker-ui.md` v0.7。

v0.4（通貨の切り替え）の変更は `docs/specs/dividend-tracker-currency.md` に書く。

v0.3 の変更点:
- 受取日が月日だけになったので、月別配当額は年を選ばない（記録の 1 年分を月ごとに出す）。年の選択 `select[name=chartYear]` と状態 `chartYear` を廃止する。
- 月別配当額の下に **年別配当額** のグラフを追加する（下の「年別配当額」）。棒の作り・保有者の色・ツールチップ・凡例は月別と同じ。
外部ライブラリ・外部 URL・canvas・SVG は使わない（HTML 要素と CSS だけで描く）。`innerHTML` / `outerHTML` という語は書かない。

v0.2 の変更点: 1 本の棒を **保有者ごとの色で積み上げる**。色の部分にマウスを乗せると保有者名と金額のツールチップを出す。グラフの下に凡例を置く。

## 対象ファイル

| ファイル                             | 変更                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/logic.ts`                       | `monthlyTotals` から年の引数を外す。`yearlyChart` を追加       |
| `src/logic.test.ts`                  | 上のテスト                                                    |
| `src/index.ts`                       | 月別の年の選択を廃止、年別配当額のグラフを追加                 |
| `modules/dividend-tracker/style.css` | 変更なし（年別も月別と同じクラスを使う）                       |

## `src/logic.ts`

```ts
export function monthlyTotals(
  records: DividendRecord[],
): { month: number; total: number; owners: { ownerId: number; total: number }[] }[]
```

- 長さ 12 の配列を返す。`month` は 1〜12 の昇順。`total` はその月に `payDate` がある payments の `amount` の合計（円）。該当が無い月は 0。
- `owners` はその月の `total` を記録の `ownerId` ごとに分けたもの。`ownerId` の昇順。合計が 0 円の保有者は含めない（0 円の月は空配列）。`owners` の `total` の和は月の `total` と一致する。
- 月は `payDate`（`MM-DD`）の先頭 2 文字で判定する（`Date` を使わない）。
- 引数の配列は変更しない。
- `yearlyChart` は `docs/specs/dividend-tracker-logic.md` v0.4 の 19。

## `src/index.ts`

- 合計額の後に `section.page-section`:
  - 見出し `h2`「月別配当額」。
  - 対象は `filterByOwner(records, filter)`（銘柄一覧と同じ保有者フィルタに従う）。0 件なら `p`「まだ記録がありません」だけを表示する。
  - グラフは `div.dt-chart-wrap`（ツールチップの位置の基準）> `ol.dt-chart`（`aria-label="月別配当額"`）。`monthlyTotals(対象)` の 12 か月分の `li.dt-chart__month`:
    - `aria-label` に月の合計と内訳: `6月: 17,400円（太郎 5,000円、花子 12,400円）`（内訳は区間と同じ順。0 円の月は `1月: 0円`）。`title` は付けない（区間のツールチップと重なるため）。
    - 子要素（上から）: `span.dt-chart__value`（`formatYen(total)`。0 円の月は空文字）、`div.dt-chart__track` > `div.dt-chart__bar`、`span.dt-chart__label`（`1月`〜`12月`）。
    - 棒の高さは `style.height = (total / 12 か月の最大値 × 100) + '%'`。最大値が 0 なら全月 `0%`。表示用の計算なので金額には使わない。
    - `div.dt-chart__bar` の中に、`owners` の保有者ごとに `div.dt-chart__segment` を置く。
      - 並び順は **色の番号の小さい順に下から**（下の「保有者の色」）。
      - 高さは `style.flexGrow = String(保有者の total)`（棒の中で金額に比例して分ける。表示用）。
      - クラス `dt-owner-color-<n>`（n は 1〜8）または `dt-owner-color-other`。
      - `data-tooltip` に `<保有者名>\n<formatYen(total)>`（例 `太郎\n5,000円`）、`data-month` に月の番号。
- **保有者の色**: `members`（家族一覧の取得順）での位置で決める。先頭から 1〜8。9 人目以降と、家族にいない保有者は `other`。
  画面の表示中に保有者フィルタを変えても、同じ保有者の色は変わらない（フィルタ後の順番では決めない）。
- **ツールチップ**: `div.dt-tooltip`（`role="tooltip"`、`hidden`）を `div.dt-chart-wrap` に 1 つ置く。
  - `container` に委譲した `pointerover`: 対象が `.dt-chart__segment` なら、`data-tooltip` の 1 行目（保有者名）と 2 行目（金額）を `textContent` で別々の `span` に入れ（1 行目 `span.dt-tooltip__name`、2 行目 `span.dt-tooltip__amount`）、`hidden` を外す。
    位置は区間の上端の中央（`div.dt-chart-wrap` 基準の `left` / `top`）。左右はグラフの幅からはみ出さないように寄せる。
  - `pointerout` で区間から出たら隠す。`draw()` でグラフごと作り直すので、ツールチップの状態は持たない。
  - タッチ端末では区間をタップしたとき（`pointerover` が来る）に同じく表示する。
- **凡例**: グラフの下に `ul.dt-legend`。グラフの棒（フィルタ後）に 1 円以上ある保有者を色の番号順に `li`。各 `li` は `span.dt-legend__swatch`（`dt-owner-color-<n>`）と、`<保有者名> <グラフ全体での合計>`（例 `太郎 18,500円`）のテキスト。保有者が 1 人でも表示する。

### 年別配当額

- 月別配当額の後（本文の一番下）に `section.page-section`、見出し `h2`「年別配当額」。
- 最後の年 `endYear` は、今年（端末のローカル時刻の年）と、登録済みの最も新しい年の大きいほう。
- 棒は `yearlyChart(yearlyTotals, endYear, filter)` の 12 年分（古い年が左）。`ol.dt-chart`（`aria-label="年別配当額"`）の `li.dt-chart__month` を月別と同じ作りで並べる。
  - 違いは、ラベル `span.dt-chart__label` が年（例 `2026`）、`aria-label` が `2026年: 1,234円（…）`、区間の `data-year` に年（`data-month` の代わり）。
  - 棒の高さは 12 年分の最大値に対する比率。登録の無い年は 0 円の棒（値は空文字）。
- 12 年分すべて 0 円なら（登録が無い、またはフィルタ後に 0 円）、グラフの代わりに `p`「まだ登録された年がありません」を出す。
- 凡例は月別と同じ（12 年分の合計）。
- 保有者の色は月別と同じ規則（同じ保有者は同じ色）。

## `modules/dividend-tracker/style.css`

- 保有者の色は `.dt-chart-wrap` に CSS 変数 `--dt-owner-1`〜`--dt-owner-8`、`--dt-owner-other` で定義し、`.dt-owner-color-<n>` は `background: var(--dt-owner-<n>)`。
  - ライト: `#2a78d6` `#eb6834` `#1baf7a` `#eda100` `#e87ba4` `#008300` `#6250d6` `#e34948`、other `#8a8f98`。
  - ダーク（`:root[data-theme='dark']` と、`prefers-color-scheme: dark` かつ `data-theme` が `light` でないとき）: `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#0ca30c` `#9085e9` `#e66767`、other `#7d838d`。
  - この 8 色は色覚多様性の検査（隣り合う色の区別）をライト・ダークとも通過している。ライトの 3 色は背景とのコントラストが 3:1 未満のため、凡例に名前と金額を必ず出す。
- `.dt-chart`: リストの記号・余白なし。12 列の grid（`repeat(12, minmax(0, 1fr))`）、列間 `--space-1`、高さ 12rem 程度、下揃え。
- `.dt-chart__month`: 縦並び（値・棒・月名）。`.dt-chart__track`: 残りの高さを占め、棒を下揃えにする。
- `.dt-chart__bar`: 縦並び（`flex-direction: column-reverse`、先頭の区間が一番下）、区間の間に 2px の隙間、上の角を 4px 丸める（`overflow: hidden` で区間ごと切る）。0% のときは見えなくてよい。
- `.dt-chart__segment`: 高さ 0 から `flex-grow` で伸びる（`flex-basis: 0`、`min-height: 2px`）。`cursor: default`。マウスを乗せた区間は少し明るく（`filter: brightness(1.1)` 程度）。
- `.dt-tooltip`: `position: absolute`、`transform` で上端の少し上・中央に置く。背景 `--color-text-primary`、文字 `--color-bg`、`--type-caption`、角丸、影、`pointer-events: none`、折り返さない。`.dt-tooltip__amount` は `tabular-nums`・太字。
- `.dt-legend`: リストの記号なし、横に並べて折り返す（`flex-wrap`）、`--type-caption`、文字色 `--color-text-secondary`。`.dt-legend__swatch` は 10px 四方・角丸 2px。
- `.dt-chart__value`: `--type-caption`、`tabular-nums`、中央揃え。幅 40rem 未満の画面では非表示。`.dt-chart__label`: `--type-caption`、`--color-text-secondary`、中央揃え。

## 受け入れ条件

- `monthlyTotals`: 12 件・1〜12 月、同じ月の複数記録・同じ記録内の同じ月以外の payments が正しく振り分けられる、記録が 0 件なら全月 0。
  `owners` が保有者ごとに正しく分かれ（同じ保有者の複数記録は合算）、`ownerId` 昇順、0 円の保有者を含まず、和が月の `total` と一致する。
- 画面: 年別配当額が月別配当額の下に 12 年分出る。登録した年の棒が出て、未登録の年は 0。月別・年別とも、棒が保有者の色で積み上がり、区間にマウスを乗せると保有者名と金額が出る。保有者フィルタを変えても色が変わらない。凡例が出る。375px 幅でも横スクロールが出ない。ライト・ダークで色が切り替わる。
- `npm run lint` / `format:check` / `typecheck` / `test` / `build` が通る。

## 出力形式

指定された 1 ファイルの内容のみ。

# 仕様: 配当管理サイドカー（server/）v0.3

v0.3 の変更点: 記録が受取日を複数持つ（`docs/specs/dividend-tracker-logic.md` v0.3）。記録の編集（PUT）を追加。保存ファイルを version 2 にし、version 1 を読み込み時に移行する。

yuvomi の横で動く小さな HTTP サービス。配当記録をサーバー側に保存し、家族全員で共有する。
yuvomi の `MODULES.md`「Modules With A Backend Service」の要件に従う。

- Node.js 22.12 以上、TypeScript を `--experimental-strip-types` で直接実行。npm 依存なし（`node:http`・`node:fs`・`node:crypto` のみ）。
- 金額計算・検証は `src/logic.ts` を import して使う（画面と同じ関数）。
- 公開パス: `/api/extensions/dividend-tracker`（リバースプロキシがパスを変えずに転送する）。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `server/app.ts` | `createHandler(deps)`。ルーティング・認証・権限・検証。I/O は `deps` 経由 |
| `server/yuvomi.ts` | yuvomi への問い合わせ（`/api/v1/auth/me`、`/api/v1/family/members`）と短期キャッシュ |
| `server/store.ts` | JSON ファイル保存 |
| `server/main.ts` | 環境変数を読み、`node:http` で起動 |
| `server/app.test.ts` | `createHandler` のテスト（yuvomi はスタブ） |

## 環境変数

| 名前 | 既定値 | 内容 |
| --- | --- | --- |
| `PORT` | `8080` | 待ち受けポート |
| `YUVOMI_INTERNAL_URL` | `http://yuvomi:3000` | サイドカーから見た yuvomi の URL |
| `PUBLIC_ORIGIN` | （必須） | ブラウザから見た yuvomi の origin（例 `https://yuvomi.example.com`） |
| `DATA_DIR` | `/data` | 保存先フォルダ |

## 認証と権限（全リクエスト）

1. `Cookie` ヘッダーが無ければ 401。
2. Cookie をそのまま付けて `GET {YUVOMI_INTERNAL_URL}/api/v1/auth/me` を呼ぶ。200 以外なら 401。
   応答から `user.id`（正の整数）、`user.role`（`'admin'` なら管理者）、`permissions.modules['ext:dividend-tracker']` を読む。
   結果は Cookie 文字列をキーに **5 秒** キャッシュする（最大 500 件、超えたら古い順に捨てる）。
   yuvomi に接続できない（通信エラー・タイムアウト 5 秒）ときは 502 `'yuvomi に接続できませんでした'`。家族一覧の取得も同じ。
3. 権限が `'none'` なら 403。値が無い場合は `'write'` 扱い（yuvomi の既定はフルアクセス）。
4. ユーザー id・役割をリクエスト本文から受け取らない。

### 書き込み（POST / PUT / DELETE）の追加条件

- `Origin` ヘッダーが `PUBLIC_ORIGIN` と完全一致しなければ 403。
- CSRF（二重送信）: Cookie `dt_csrf` とヘッダー `X-DT-CSRF` が両方あり一致しなければ 403。比較は `timingSafeEqual`。
- 権限が `'read'` なら 403。

## ルート

すべての応答は JSON、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`。エラーは `{ "error": "<日本語メッセージ>", "code": "<識別子>" }`。

### `GET /api/extensions/dividend-tracker/records`

- 200 `{ data: DividendRecord[], me: { id, isAdmin, canWrite }, csrfToken }`。全員分を返す（閲覧は全員可）。
- `dt_csrf` Cookie が無い・形式不正（32 バイト乱数の hex 64 文字でない）なら新規発行して `Set-Cookie`:
  `dt_csrf=<token>; Path=/api/extensions/dividend-tracker; HttpOnly; SameSite=Strict`（`PUBLIC_ORIGIN` が https なら `; Secure`）。
  `csrfToken` には Cookie と同じ値を入れる。

### `POST /api/extensions/dividend-tracker/records`

- `Content-Type` が `application/json` で始まらなければ 415。本文 16 KB 超は 413。JSON 不正は 400。
- 本文 `{ ownerId, ticker, name, sharesText, payments: [{ payDate, perShareText }] }`（`RecordInput`）。
  型が違えば 400 `'データの形式が正しくありません'`（`ownerId` が number、`ticker`・`name`・`sharesText` が string、`payments` が配列で各要素の `payDate`・`perShareText` が string）。
  `payments` が MAX_PAYMENTS 件を超える場合は要素の型を調べる前に `validateInput` のメッセージで 400 にしてよい。
- `validateInput` がメッセージを返したら 400（そのメッセージ）。
- `ownerId` が `GET /api/v1/family/members`（呼び出し者の Cookie で取得、5 秒キャッシュ）の `id` に無ければ 400 `'保有者が家族にいません'`。
- 管理者でなく `ownerId !== me.id` なら 403 `'自分以外の記録は管理者だけが追加できます'`。
- 保存するレコード: `id = crypto.randomUUID()`、`ticker`・`name` は trim、`shares` は parse 結果、`payments = buildPayments(shares, input.payments)`、
  `createdBy = me.id`、`createdAt = updatedAt = new Date().toISOString()`。本文に `amount`・`perShareCents` などがあっても無視する。
- 201 `{ data: DividendRecord }`。

### `PUT /api/extensions/dividend-tracker/records/<id>`

- 本文の受け取りと検証（415 / 413 / 400 / 家族チェック）は POST と同じ。
- 該当なし 404 `'記録が見つかりません'`。
- 管理者でなく、既存の `record.ownerId !== me.id` なら 403 `'自分以外の記録は管理者だけが編集できます'`。
- 管理者でなく、本文の `ownerId !== me.id` なら 403 `'自分以外の記録は管理者だけが追加できます'`（保有者を他人に付け替えられない）。
- 保存するレコード: `id`・`createdBy`・`createdAt` は既存のまま。`ownerId`・`ticker`・`name`・`shares`・`payments` は POST と同じ規則で本文から作る。`updatedAt = new Date().toISOString()`。
- 200 `{ data: DividendRecord }`。

### `DELETE /api/extensions/dividend-tracker/records/<id>`

- 該当なし 404。管理者でなく `record.ownerId !== me.id` なら 403 `'自分以外の記録は管理者だけが削除できます'`。
- 200 `{ data: { id, deleted: true } }`。

### その他

- パスが一致しなければ 404、メソッドが違えば 405（`/records` は GET・POST、`/records/<id>` は PUT・DELETE）。
- `GET /api/extensions/dividend-tracker/health` は認証なしで 200 `{ ok: true }`（コンテナのヘルスチェック用。データは返さない）。

## 保存（store.ts）

- `{DATA_DIR}/records.json` に `{ "version": 2, "records": [...] }`。ファイルが無ければ空。
- 起動時に読む。`version` が 2 なら `isValidRecord` を満たすものだけ使う。`version` が 1 なら各要素を `migrateLegacyRecord` で変換し、null でないものだけ使う（ファイルは次の書き込み時に version 2 で書き直される）。それ以外の version は空として扱わず、起動を失敗させる（例外）。
- `Store` は `list()`・`get(id)`・`add(record)`・`update(record): Promise<boolean>`（同じ id を置き換える。無ければ false）・`remove(id)`。
- 書き込みは一時ファイル → `rename` で置き換え。同時書き込みは Promise チェーンで直列化する。
- メモリ上の配列を正とし、書き込み失敗時は変更を元に戻して 500 `'保存できませんでした'`。

## 受け入れ条件（テスト）

- Cookie なし 401 / auth/me が 401 → 401 / 権限 none → 403。
- GET が全員分と `me`・`csrfToken` を返し、`Set-Cookie` を付ける。
- POST: Origin 不一致 403、CSRF 不一致 403、read 権限 403、検証エラー 400、家族以外の ownerId 400、非管理者が他人の ownerId 403、管理者は他人の分を追加できる、amount はサーバーが計算する（本文の amount は無視）。
- PUT: 非管理者が他人の記録 403、非管理者が保有者を他人に変える 403、本人は編集可（`createdAt` は変わらず `updatedAt` が変わる）、管理者は他人の記録も編集可、存在しない id 404、検証エラー 400。
- store: version 1 のファイルを移行して読み込み、書き込み後は version 2 になる。
- DELETE: 非管理者が他人の記録 403、本人は削除可、管理者は他人の記録も削除可、存在しない id 404。

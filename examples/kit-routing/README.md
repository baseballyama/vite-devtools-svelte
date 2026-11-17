# kit-routing — ルーティングとデータ読み込みの全パターン

SvelteKit 3（SSR）のルーティング・`load`・フォームアクション・エンドポイント・hooks を一通り踏むアプリです。**Routes / Load functions / API / Components / Problems** パネルの確認に使います。

```bash
pnpm examples kit-routing        # http://localhost:5206/ （リポジトリのルートから）
pnpm examples kit-routing --dock # Vite DevTools のドック内で
```

## ルート一覧

| URL                              | ルート ID / ファイル                                                      | 確認ポイント                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`                              | `+layout.server.ts`（ルート）                                             | すべてのページで最初に走るサーバー load                                                                                             |
| `/about`, `/contact`, `/pricing` | `(marketing)/…` + `(marketing)/+layout.svelte`                            | グループは URL に出ない。`/contact` は default action のみ。`/pricing` は `prerender = true`                                        |
| `/landing`                       | `(marketing)/landing/+page@.svelte`                                       | レイアウトリセット（marketing レイアウトを飛ばす）                                                                                  |
| `/legacy-about`                  | `src/hooks.ts` の `reroute`                                               | URL はそのまま `/about` が描画される                                                                                                |
| `/dashboard`                     | `(app)/+layout.server.ts` → `+layout.ts` → `+page.server.ts` → `+page.ts` | 4 種類の load が 1 本のチェーンに。`await parent()` による順次実行、サーバー load 同士は並列                                        |
| `/dashboard`                     | 同上                                                                      | ストリーミング（未 await の Promise）、`depends('app:clock')` + `invalidate` / `invalidateAll`、`transport` で `Money` クラスを転送 |
| `/dashboard/fail`                | `(app)/dashboard/+error.svelte`                                           | `error(503)` → ネストした `+error.svelte`（(app) レイアウトは残る）                                                                 |
| `/settings`                      | `(app)/settings/+page.server.ts`                                          | 名前付きアクション `?/profile`・`?/newsletter`、`fail()`、`use:enhance`、`snapshot()`                                               |
| `/admin/reports`                 | `(app)/admin/reports/+layout@(app).svelte`                                | レイアウトリセット（admin レイアウトを飛ばし (app) へ）                                                                             |
| `/blog`                          | `blog/+page.js`                                                           | `.js` の load ファイル                                                                                                              |
| `/blog/[slug]`                   | `blog/[slug]/+page.server.ts`                                             | 通常の param、存在しない slug は 404                                                                                                |
| `/lang`, `/lang/ja`              | `lang/[[lang]]`                                                           | 省略可能な param                                                                                                                    |
| `/docs/a/b/c`                    | `docs/[...path]`                                                          | rest param。load は `export { load }` 形式 → **Load functions に出ないのが正しい**                                                  |
| `/items/2`                       | `items/[id=integer]` + `src/params.ts`                                    | マッチャー（SvelteKit 3 の `defineParams`）。`/items/abc` はどのルートにも一致せず 404                                              |
| `/items/2`                       | 同上                                                                      | `export const ssr = true, load = …`（他の export と同じ文の load）も計測される                                                      |
| `/files/report.pdf`              | `files/[name].[ext]`                                                      | 1 セグメントに 2 つの param                                                                                                         |
| `/.well-known`                   | `[x+2e]well-known/+server.ts`                                             | エスケープされたセグメント（`.`）                                                                                                   |
| `/photos` → 写真クリック         | `photos/+page.svelte`, `photos/[id=integer]`                              | shallow routing（`preloadData` + `goto(…, { shallow: true })`）でモーダル表示                                                       |
| `/static-only`                   | `static-only/+page.ts`                                                    | `csr = false`：JS なし。Svelte コンポーネントはランタイムに現れない                                                                 |
| `/slash`                         | `slash/+page.ts`                                                          | `trailingSlash = 'always'`（`/slash/` へ 308）                                                                                      |
| `/old-redirect`                  | `old-redirect/+page.server.ts`                                            | load 内の `redirect(307)` → 計測されない                                                                                            |
| `/broken`, `/crash`              | `broken/+page.server.ts`, `crash/+page.ts`                                | `error(418)`（想定内エラー）と予期しない throw（`handleError` 経由、サーバー／クライアント両方）                                    |
| `/api-console`                   | `api/items`, `api/text`, `api/stream`                                     | GET/POST/PUT/PATCH/DELETE/OPTIONS + `fallback`（PROPFIND）、JSON・テキスト・ストリーミング応答                                      |

hooks: `hooks.server.ts`（`sequence` した `handle`、`handleFetch` で `/api/*` にヘッダ付与、`handleError`）、`hooks.client.ts`（`handleError`）、`hooks.ts`（`reroute`、`transport`）。

## 確認項目

- [ ] **Routes**: 上表のルートがすべて出る。`(app)` / `(marketing)` が URL に含まれない、`/lang/:lang?`・`/docs/*path`・`/items/:id`（matcher `integer`）・`/files/:name.:ext`・`/.well-known` が正しい。`+page@.svelte` / `+layout@(app).svelte` のルートが消えていない
- [ ] **Load functions**: `/dashboard` をフルリロードすると 4 つの load（server ×2 が並列、universal ×2 が親待ちで順次）が並ぶ。クライアント遷移では universal load がブラウザ側の計測として届く
- [ ] **Load functions**: `/docs/…`（`export { load }`）・`/old-redirect`・`/broken`・`/crash` の load は記録されない。`/blog`（`.js`）と `/items/2` は記録される
- [ ] **Load functions**: 「invalidate('app:clock')」で `+page.server.ts` が再実行されて記録が増える
- [ ] **API**: `api/items` の全メソッド、`api/text`、`api/stream`、`/.well-known` が一覧に出て実行できる
- [ ] **Components**: `/admin/reports` で admin レイアウトが木に含まれない。`/photos` のモーダルで `photos/[id=integer]/+page.svelte` が `photos/+page.svelte` の子として出る
- [ ] **Components**: `/static-only` をフルロードすると木が空（JS なし）。他ページへ戻ると復帰する
- [ ] **State timeline / Reactivity**: `/settings` の入力、ナビゲーションログ（ルートレイアウトの `log`）、`/pricing` の yearly 切替
- [ ] **Problems**: `/crash` の予期しないエラーが記録される
- [ ] **Social preview**: `/blog/hello-world` の `og:title` が反映される
- [ ] `--dock` 時、SSR HTML に `/__devtools/embedded.js` が注入され、ドックの Svelte タブが開く

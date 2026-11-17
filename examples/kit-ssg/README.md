# kit-ssg — 全ページ prerender（adapter-static）

ルートで `prerender = true` / `trailingSlash = 'always'` を指定した静的サイト。
dev ではサーバー load が毎リクエスト走り、`vite build` で全ページと `+server.ts` が `build/` に書き出されます。

```bash
pnpm examples kit-ssg               # http://localhost:5210/
pnpm -C examples/kit-ssg build      # build/ に全ページ・feed.json・sitemap.xml
```

| ルート                       | 使っている機能                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                          | ルート `+layout.server.ts`（server load）+ `+page.ts`（universal load、`parent()`）            |
| `/blog/`                     | `+page.server.ts`                                                                              |
| `/blog/[slug]/`              | `entries()` で列挙される動的ルート、server load + universal load の両方、`{#key}` で再マウント |
| `/no-js/`                    | `csr = false`（JS なし → devtools ランタイムも動かない）                                       |
| `/client-only/`              | `ssr = false`（prerender では空のシェル、描画はブラウザのみ）                                  |
| `/feed.json`, `/sitemap.xml` | prerender される `+server.ts`（`trailingSlash = 'never'`）                                     |

## 確認項目

- [ ] **Routes**: 7 ルート（うち 2 つが endpoint、`blog/[slug]` は動的）
- [ ] **Load functions**: `/` で server + universal、`/blog/[slug]/` で server + universal の両方が記録される。`/client-only/` の universal load はブラウザから届く
- [ ] **Components**: `/blog/[slug]/` で `Likes` が出て、別記事に移ると `{#key}` で別インスタンスになる
- [ ] `/no-js/` を開いてもアプリ・DevTools がエラーにならない（ランタイムがないので Components は空 / 直前のページのまま）
- [ ] **Social preview**: `/` が og:title / og:image 付きで出る。trailingSlash = 'always' のルート（`/blog` など）はリダイレクトになる
- [ ] **API**: `GET /feed.json`, `GET /sitemap.xml` が呼べる
- [ ] **Assets**: `static/og.svg`
- [ ] `vite build` が通り、`build/` に devtools 由来のコード（`svelte-devtools` / `__devtools`）が含まれない

# kit-config — 既定値でない SvelteKit 設定

DevTools が「既定の SvelteKit」を前提にしていないかを確かめるためのアプリ。`vite.config.ts` で次を変えています。

| 設定                             | 値               | 影響しうる DevTools 機能                          |
| -------------------------------- | ---------------- | ------------------------------------------------- |
| `paths.base`                     | `/base`          | Assets の公開 URL、Social preview、API、dock 注入 |
| `appDir`                         | `_custom_app`    | クライアントのアセット URL                        |
| `files.routes`（非推奨だが有効） | `src/app-routes` | Routes 解析、Load functions のルート ID           |
| `embedded`                       | `true`           | イベントがアプリの親要素で処理される              |
| `trailingSlash`（ルート layout） | `'always'`       | ルートの URL・Social preview                      |

```bash
pnpm examples kit-config            # http://localhost:5211/base/  （DevTools は http://localhost:5211/.svelte-devtools/）
```

ルート: `/base/`（server load + `POST` で endpoint 呼び出し）、`/base/about/`（universal load）、`/base/items/[id]/`（server load、404 あり）、`/base/api/echo`（GET / POST の `+server.ts`）。

## 確認項目（2026-11-17 時点の結果）

- [x] アプリが `/base/` で動き、クライアント遷移・endpoint 呼び出し・404 が正しい
- [x] DevTools は base に関係なく `/.svelte-devtools/` で開く（`/base/.svelte-devtools/` は 404）
- [x] dock モードでも `/__devtools/embedded.js` が注入されドックが出る
- [x] **Assets**: `static/logo.svg` の公開 URL が `/base/logo.svg` と表示され、プレビューも出る
- [x] **API**: `http://localhost:5211/base/api/echo` を直接入力すれば呼べる
- [x] **Routes**: `files.routes` の `src/app-routes` 配下のルートが出る
- [ ] **Load functions**: 記録はされるが、すべてのルート ID が `/` になる（`app-routes` 配下のディレクトリをルートとして扱えていない）→ **既知のギャップ**
- [ ] **API**: エンドポイント一覧が空（Routes に依存）
- [ ] **Social preview**: ルート一覧が空。`http://localhost:5211/` は `/base` へのリダイレクトで失敗、`http://localhost:5211/base/` を直接入力すれば取れる。`og:image` が相対 URL（`./logo.svg`、`paths.relative` の既定）でも警告されない

# kit-spa — `ssr = false` の SvelteKit SPA

ルート `+layout.ts` で `export const ssr = false` を指定した SPA です（`adapter-static` の `fallback: '200.html'`）。サーバーで何もレンダリングしないため、**すべての load は universal load としてブラウザで実行**されます。load のタイミングはサーバー側のレコーダーではなく HMR チャンネル経由で DevTools に届く（`load-profile.ts` の `LOAD_PROFILE_EVENT`）ので、その経路を確かめるためのアプリです。データは `static/data/*.json` を load の `fetch` で取得します。

| ルート        | ポイント                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| `/`           | `+layout.ts`（`depends('app:site')`）→ `+page.ts` が `await parent()` してから fetch      |
| `/users`      | `?role=` の search param で load が再実行、`goto()` で絞り込み、お気に入り（★）           |
| `/users/[id]` | 動的パラメータ。存在しない id (`/users/999`) は `error(404)` → `+error.svelte`            |
| `/live`       | `depends('app:clock')` + `invalidate()` / `refreshAll()`、1 秒ごとの自動 invalidate       |
| `/settings`   | localStorage に永続化する `.svelte.ts` モジュールの `$state`（`src/lib/prefs.svelte.ts`） |

レイアウトは `$app/state` の `page` / `navigating`、`beforeNavigate` / `afterNavigate` のログを表示します。

## 確認項目

- [ ] Load functions: どの load も `universal` として記録される（`server` は 0 件）。`/` では layout → page の順の waterfall
- [ ] `/live` で invalidate するたびに `/live` の load 件数が増える。`refreshAll()` では layout の load も増える
- [ ] `/users/999` の 404（load が throw）は記録されず、エラーページが表示される
- [ ] Routes: `/`, `/live`, `/settings`, `/users`, `/users/:id` が universal load 付きで並ぶ
- [ ] Components: クライアント遷移のたびに `+page` が差し替わり、`+layout` は残る
- [ ] Reactivity / State timeline: `prefs`（モジュールの state）が、コンポーネントではなくモジュール配下に出る。設定変更・★で変化が記録される
- [ ] ページをリロードしても DevTools が新しいページロードとして追従する
- [ ] ドックモード (`SVELTE_DEVTOOLS_DOCK=1`) でもドックが表示される

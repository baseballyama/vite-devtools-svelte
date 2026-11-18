# svelte-middleware — Vite middleware mode + SSR + hydrate

SvelteKit を使わない素の Svelte を、自前の Node サーバー (`server.js`、`node:http` のみ) から配信するアプリです。Vite は `server.middlewareMode: true` で起動するため Vite 自身の `httpServer` が無く、DevTools は **SSE トランスポート**で通信します（HMR の WebSocket は `hmr.server` で自前サーバーに相乗り）。ページはリクエストごとに `svelte/server` の `render()` でサーバーレンダリングし、ブラウザで `hydrate()` します。

```bash
pnpm -C examples/svelte-middleware dev          # http://localhost:5205/
SVELTE_DEVTOOLS_DOCK=1 pnpm -C examples/svelte-middleware dev   # Vite DevTools のドック
```

middleware mode では plugin が `listening` を受け取れず MCP の登録コマンドを出さないため、`server.js` が plugin の API (`getDevtoolsToken`) から代わりに出力します。

| ファイル                   | 内容                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `server.js`                | middleware mode の Vite、`ssrLoadModule` + `transformIndexHtml` で SSR |
| `src/entry-server.ts`      | `render()` とサーバーから渡す初期 props                                |
| `src/entry-client.ts`      | `window.__INITIAL_PROPS__` で `hydrate()`                              |
| `src/lib/Counter.svelte`   | サーバー由来の prop を初期値にした `$state` / `$derived` / `$effect`   |
| `src/lib/Checklist.svelte` | keyed `#each` + `bind:checked` + `$derived`                            |
| `src/lib/Clock.svelte`     | ハイドレーション後にだけ動く `$effect`（タイマー）                     |

## 確認項目

- [ ] `/.svelte-devtools/` が開き、ヘッダーが **Connected** になる（SSE 経由。WebSocket `/.svelte-devtools/__ws` は張られない）
- [ ] Components: `App` > `Counter` / `Checklist` / `Clock` の 4 つ。ハイドレーション後もツリーが重複しない
- [ ] ページの「hydrated」表示と、ハイドレーションミスマッチ警告がコンソールに出ないこと
- [ ] Counter をクリックすると State timeline / Reactivity に `count` の変化が出る。Clock の `now` が毎秒更新される
- [ ] Render: Clock が毎秒再レンダーとして記録される
- [ ] Routes / Load functions: SvelteKit ではないので空の状態表示
- [ ] Svelte Inspector (Alt+X) でページ上の要素をクリックすると `Counter` などが選ばれる
- [ ] ドックモード (`SVELTE_DEVTOOLS_DOCK=1`): ドックが出て Svelte タブが開ける
- [ ] `server.js` が出力する MCP コマンドで `get_live_components` が 4 件返る

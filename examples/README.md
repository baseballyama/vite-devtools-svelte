# examples

`vite-devtools-svelte` の動作確認用アプリ群です。DevTools の挙動を変えうるアプリの形（Svelte 単体 / SvelteKit の SSR・SPA・SSG・remote functions・非デフォルト設定、Vite の middleware mode、ライブラリコンポーネント、strict CSP など）を 1 アプリ 1 テーマで揃えています。

## 全部まとめて起動

リポジトリのルートで:

```bash
pnpm install
pnpm build              # plugin + DevTools UI（アプリは dist を読む）
pnpm examples           # 全アプリをスタンドアロン（/.svelte-devtools/）で起動
pnpm examples --dock    # 全アプリを Vite DevTools のドック内で起動
```

- 各アプリは固定ポートで起動し（下表）、ログは行頭にアプリ名を付けて 1 つのターミナルにまとまります。Ctrl+C で全部止まります。
- `pnpm examples kit-spa kit-ssg` のようにアプリ名を並べるとそれだけ起動します。`pnpm examples --list` で一覧。
- 確認を速くするため、このスクリプト経由ではワンタイムコード認証をオフにします（`SVELTE_DEVTOOLS_CLIENT_AUTH=0`、localhost のみで待ち受け）。認証フローも確認したいときは `--auth`。
- `--dock` は `SVELTE_DEVTOOLS_DOCK=1` を渡します。`sample-app` と `strict-csp-app` は常にドック構成です。

## アプリ一覧

| アプリ                                   | ポート | 形                                                       | 主に確かめること                                                                                                                                                                                        |
| ---------------------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [plain-svelte](./plain-svelte)           | 5201   | Svelte + Vite（最小）                                    | 最小構成で全パネルが空状態も含めて正しく出る（compat スモークのプロファイル）                                                                                                                           |
| [sample-app](./sample-app)               | 5202   | SvelteKit SSR（デモ EC）                                 | 一通りのパネル。スクリーンショットと MCP 例の収録元                                                                                                                                                     |
| [strict-csp-app](./strict-csp-app)       | 5203   | SvelteKit + nonce の strict CSP                          | `script-src 'self'` 下でドック注入と RPC が動く                                                                                                                                                         |
| [svelte-features](./svelte-features)     | 5204   | Svelte + Vite（機能網羅）                                | 複数マウントルート、snippet / 動的コンポーネント / boundary / context / クラス state / module state、legacy コンポーネント、custom element、`node_modules` のライブラリコンポーネント、大量行のレンダー |
| [svelte-middleware](./svelte-middleware) | 5205   | 自前 Node サーバー + Vite middleware mode、SSR + hydrate | httpServer の無い Vite（SSE トランスポート）、hydrate されたツリー                                                                                                                                      |
| [kit-routing](./kit-routing)             | 5206   | SvelteKit SSR（ルーティング / データ網羅）               | グループ・レイアウトリセット・各種パラメータ・matcher・エスケープ、全 load 種別と waterfall、streaming、actions、全メソッドの endpoint、hooks、エラー                                                   |
| [kit-remote](./kit-remote)               | 5207   | SvelteKit remote functions + Svelte async                | query / query.batch / form / command / prerender、テンプレート内 `await`、pending な boundary                                                                                                           |
| [kit-spa](./kit-spa)                     | 5208   | SvelteKit SPA（`ssr = false`）                           | load がブラウザでだけ走る（HMR チャネル経由の load 計測）                                                                                                                                               |
| [kit-hash](./kit-hash)                   | 5209   | SvelteKit SPA + hash router                              | `#/…` の URL でのルート・load・コンポーネント                                                                                                                                                           |
| [kit-ssg](./kit-ssg)                     | 5210   | SvelteKit SSG（adapter-static, `prerender = true`）      | prerender ページと endpoint、`entries()`、JS の無い `csr = false` ページ                                                                                                                                |
| [kit-config](./kit-config)               | 5211   | SvelteKit 非デフォルト設定                               | `paths.base`・`appDir`・`files.routes`・`embedded`・`trailingSlash` 下での各パネル（アプリは `/base/`）                                                                                                 |
| [ui-lib](./ui-lib)（アプリではない）     | —      | Svelte コンポーネントライブラリ                          | `dependenciesMeta.injected` で入れるので `node_modules` 配下に解決され、公開ライブラリと同じ扱いになる                                                                                                  |

各アプリの README に、ページごとの内容とパネルごとの確認項目があります。

## アプリを足すとき

`examples/<name>/package.json` に `"devtoolsExample": { "port": <未使用のポート> }` を書くと `pnpm examples` の対象になります（アプリの URL が `/` 以外なら `"base": "/base/"`、`vite dev` ではなく自前サーバーなら `"server": "server.js"`。サーバーは `PORT` を読むこと）。`vite.config.ts` では `SVELTE_DEVTOOLS_DOCK` と `SVELTE_DEVTOOLS_CLIENT_AUTH` を読んでください（既存アプリと同じ書き方）。

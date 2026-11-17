# kit-hash — ハッシュルーター (`router.type: 'hash'`)

`router: { type: 'hash' }` の SvelteKit アプリです。URL は `/#/notes/hash-router` の形になり、サーバーは常に `/` しか受け取りません。ハッシュルーターではページオプション（`ssr` など）を書くとエラー (`router_hash_page_options`) になるため、ルートには何も指定していません。アプリは構造上クライアント専用で、load はすべてブラウザで動く universal load です。ビルドは `adapter-static`（fallback なし。`build/index.html` がシェル）。

| ルート (`#/…`)   | ポイント                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| `#/`             | `+page.ts`、クリックで増える `$state`                                           |
| `#/notes`        | ネストしたレイアウト（`notes/+layout.ts` で一覧を load、絞り込みの `$derived`） |
| `#/notes/[slug]` | 動的パラメータ、`await parent()`、存在しない slug は `error(404)`               |
| `#/about`        | `goto('#/notes/…')` によるプログラム遷移                                        |

## 確認項目

- [ ] Routes: ファイルベースのルート (`/`, `/about`, `/notes`, `/notes/:slug`) がハッシュ URL とは無関係に一覧される
- [ ] Load functions（#147 以降。main では空）: すべて `universal`。ルート id (`/notes/[slug]` など) で記録され、`#/notes/a` → `#/notes/b` の遷移で件数が増える
- [ ] Components: `#/notes/…` では `+layout` > `+layout`(notes) > `+page` の 3 段。ノート間の遷移で notes レイアウトは再マウントされない
- [ ] Pick element で要素からコンポーネントを選べる（URL がハッシュでも問題ない）
- [ ] ドックモード (`SVELTE_DEVTOOLS_DOCK=1`) でもドックが表示される

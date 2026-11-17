# kit-remote — リモート関数 + Svelte async

SvelteKit の **remote functions**（`experimental.remoteFunctions`）と Svelte の **async**（`compilerOptions.experimental.async`）を使うアプリ。
`await` をマークアップ / `$derived` に直接書くコンポーネント、`<svelte:boundary>` の `pending` / `failed`、楽観的更新など、
コンポーネントツリーとリアクティビティの見え方が通常のアプリと変わる箇所を集めています。

```bash
pnpm examples kit-remote            # http://localhost:5207/
```

| ルート         | 使っている機能                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | `query`（引数なし）、`form`（`invalid()` によるサーバー検証・`.enhance`・`pending`）、`command` + `withOverride`（楽観的更新）、`.refresh()` |
| `/todo/[id]`   | `$derived(await Promise.all([...]))`、パラメータ変更での再取得、`query.batch` との併用                                                       |
| `/batch`       | `query.batch`（行ごとの `getUser(id)` が 1 リクエストにまとまる）、行ごとの `<svelte:boundary>`                                              |
| `/errors`      | 例外を投げる query → `failed` スニペット、`error(404)` → `reset()`、`.error` / `.loading` の直接参照                                         |
| `/live`        | `query.live`（ストリーム購読、`reconnect()`）、`getRequestEvent()`                                                                           |
| `/classic`     | 従来の `+page.server.ts` の `load` とリモート `query` の並置                                                                                 |
| `/prerendered` | `prerender()` 関数                                                                                                                           |

リモート関数は `src/lib/todos.remote.ts`、データは `src/lib/server/db.ts`（インメモリ）。

## 確認項目

- [ ] **Components**: `+layout` › `+page` › `TodoItem` ×N が出る。追加・削除でツリーが増減する。`/batch` のスライダーで `UserRow` が増減する
- [ ] **Components / Reactivity**: `TodoItem` の `flips`、`/` の `all`・`doneCount`（async derived）が値付きで見える。チェックボックス操作で更新される
- [ ] **State timeline**: トグル・追加・`/batch` のスライダーで `$state` の変化が記録される
- [ ] **Render**: 楽観的更新（`withOverride`）とサーバー確定時の 2 回の再描画が計測される
- [ ] **Load functions**: `/classic` の `+page.server.ts` が記録される（リモート関数の呼び出しは load ではないので**出ない**のが現状の仕様）
- [ ] **Routes**: 7 ルートが出る（`*.remote.ts` が生やす内部エンドポイントは出ない）
- [ ] **Problems**: `/errors` の失敗が `failed` スニペットに収まり、未処理エラーとして溢れない
- [ ] **Pick element**（Alt+X）: `await` で遅れて描画された要素からも正しいコンポーネントが選択される
- [ ] dock モード（`pnpm examples --dock kit-remote`）でも同じ

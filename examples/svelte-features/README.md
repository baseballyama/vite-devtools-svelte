# svelte-features — Svelte 機能網羅アプリ（SvelteKit なし）

コンポーネントツリーとリアクティビティの形に影響する Svelte の機能を、プレーンな Svelte + Vite で一通り揃えたアプリです。ポートは 5204。

```bash
pnpm build                            # リポジトリのルートで plugin + UI をビルド
pnpm examples svelte-features         # 単体で起動（--dock で Vite DevTools のドック内）
```

`examples-ui-lib`（`examples/ui-lib`）は `dependenciesMeta.injected` でインストールしているので、npm の公開ライブラリと同じく `node_modules` 配下に置かれます。ui-lib を編集したら `pnpm install` し直してください。

## セクション

| セクション   | 内容                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (ヘッダー)   | マウントルート 3 つ: `#app` の `App`、`#widget` の `Widget`、ボタンで `mount()` / `unmount()` する `Floating`（`document.body`）。カスタム要素 `<x-badge>`                                                                                |
| blocks       | `{#if}` の mount/unmount、keyed `{#each}`（追加・削除・並べ替え、`animate:flip`、`transition:`）、`{#key}` の再マウント、`{#await}`（resolve / reject）、再帰 `Tree`                                                                      |
| elements     | `{#snippet}` / `{@render}`、`children`、子に渡す snippet（引数つき）、`<svelte:element>`、`<svelte:window>` / `<svelte:document>` / `<svelte:head>`、変数に入れた動的コンポーネント（`App` のセクション切り替え）                         |
| boundaries   | `<svelte:boundary>`：描画中に throw する子、`failed` snippet、`reset`                                                                                                                                                                     |
| bindings     | `setContext` / `getContext`（入れ子）、`$bindable` + `bind:`、`bind:this`（要素とコンポーネントの export 関数）、コールバック props                                                                                                       |
| shared-state | `.svelte.ts` のモジュール `$state` オブジェクト、`$state` / `$derived` フィールドを持つクラス（コンポーネント外と内で生成）、`$state.raw`、`$derived.by`、`$effect.pre`、コンポーネント外の `$effect.root`、`$state.snapshot`、`$inspect` |
| directives   | アクション（`use:clickOutside`）とアタッチメント（`{@attach}`、引数が変わると再実行）                                                                                                                                                     |
| legacy       | runes を使わないレガシーモードのコンポーネント（`export let`、`$:`、`createEventDispatcher`、`<slot>` / 名前つき slot）を runes の親から使う                                                                                              |
| library      | ライブラリの `Card` / `LibButton` / `Tabs` に、アプリのコンポーネントを children / snippet として渡す                                                                                                                                     |
| problems     | わざと出しているコンパイラ警告（a11y 3 件）と、boundary の外で投げる実行時エラー                                                                                                                                                          |
| stress       | 約 1000 行の描画と全行の一斉更新（Render プロファイラ用）                                                                                                                                                                                 |

`svelte-check` は `Badge.ce.svelte` に `options_missing_custom_element` も出します。`vite.config.ts` の `dynamicCompileOptions` で `customElement: true` を付けているのが svelte-check からは見えないためで、アプリの問題ではありません。

## 確認項目

- **Components**
  - [ ] ルートが `App`・`Widget`・`Badge.ce`（カスタム要素）の 3 つ並び、「mount floating root」で `Floating` が増え、もう一度押すと消える
  - [ ] library セクションで `Card` / `LibButton` / `Tabs` がツリーに出ず、中の `Ticker` / `Tree` が `Library` の直下に来る
  - [ ] blocks の再帰 `Tree` が入れ子で出る。`{#key}` の再マウントや `{#if}` の切り替えでノードが入れ替わる
  - [ ] 選択した `Slider` / `Consumer` の props・state が操作に追従する。レガシーの `LegacyCounter` も props と値が見える
- **Svelte Inspector**（Alt+X / Option+X で要素を右クリック → Inspect）
  - [ ] 2 つ目・3 つ目のルート（右下の Widget、左下の Floating）の要素から、そのインスタンスを選べる
  - [ ] ライブラリの `Card` の中身を Inspect すると、最も近いアプリのコンポーネントが選ばれる。右クリックのメニューにライブラリの行は「Open」だけ
  - [ ] 動的コンポーネント（セクション）と `<svelte:element>` の要素でも選択できる
  - [ ] ラベルに要素のタグではなくインスタンス名（例 `<Slider>`）が出る
  - [ ] 右クリックのメニューで外側のコンポーネントの行の Inspect を押すと、そのインスタンスが選ばれ、エディタは開かない。Open ではエディタが開く
- **Reactivity**
  - [ ] 概要に `src/lib/state.svelte.ts`（モジュール状態）が出て、shared-state の操作で数が増える
  - [ ] `SharedState` を選ぶと `Counter` クラスの `count` / `doubled` / `parity`、`$effect.pre` がつながって見える
  - [ ] `$effect.root` を start すると、コンポーネント外の effect が `state.svelte.ts` 側に現れる
- **Render**
  - [ ] stress で 1000 行を出し「update every row」を押すと `Row` の描画回数と時間が増える
  - [ ] blocks の `Ticker`（毎秒）と `Floating`（毎秒）が継続して描画される
- **State timeline**
  - [ ] ヘッダーの `shared.clicks`、`Counter.count`、`$state.raw` の差し替え、レガシーの `count` の変化が記録される
- **Problems**
  - [ ] `src/sections/Problems.svelte` の a11y 警告 3 件が出る
  - [ ] problems の「throw a runtime error」と boundaries の「throw」（boundary が捕捉）が実行時エラーとしてどう扱われるか
- **Compiled output**
  - [ ] runes のコンポーネント、レガシーの `LegacyCounter.svelte`、カスタム要素の `Badge.ce.svelte` のコンパイル結果が見られる
- **Modules**
  - [ ] `src/main.ts` → `App.svelte` → 各セクション、`src/lib/roots.ts` → `Floating.svelte`、`examples-ui-lib` の依存が見える

ドックモード（`pnpm examples svelte-features --dock`）でも同じ項目を確認します。

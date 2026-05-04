# 実装レビューチェックリスト（vite-devtools-svelte）

`full-code-review` の Phase 3（実装）で Agent が参照する実装レベルのレビュー観点。
すべての PR は、変更内容に応じた適切なテストカバレッジを持つ必要がある。

**レビュー優先順位**: セキュリティ > production への副作用 > パフォーマンス > 正確性 > 可読性

---

## セキュリティ観点（最優先）

### 外部 URL fetch の SSRF 防御

OG プレビューや API プレイグラウンドのように、ユーザー入力 URL に対して `fetch` を行う箇所では、必ず **private IP / loopback / 内部ホスト名** をブロックする：

```ts
// ✅ plugin.ts の validateExternalUrl が参考実装
function validateExternalUrl(urlStr: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('Blocked: loopback address')
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked: private IP address ${hostname}`)
    }
  } else {
    const lower = hostname.toLowerCase()
    if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
      throw new Error(`Blocked: internal hostname ${hostname}`)
    }
  }
}
```

**新しく外部 URL を受け取る RPC を追加する場合、必ず `validateExternalUrl` を通すこと。**

`isPrivateIP` のチェック範囲（`127.0.0.0/8` / `10.0.0.0/8` / `172.16.0.0/12` / `192.168.0.0/16` / `169.254.0.0/16` / `0.0.0.0`）を回避するロジックが入っていないか確認。

### ファイルサーブのパストラバーサル防御

`/__svelte-devtools/asset` のように、リクエストパラメータからローカルファイルを返す箇所では、`fs.realpathSync` で symlink を解決した上で、許可ディレクトリの prefix 一致を確認する：

```ts
// ✅ symlink を辿って実パスでチェック
const realStaticDir = fs.realpathSync(projectInfo.staticDir)
const realPath = fs.realpathSync(resolvedPath)
if (!realPath.startsWith(realStaticDir + path.sep) && realPath !== realStaticDir) {
  res.statusCode = 403
  res.end('Forbidden')
  return
}
```

`path.resolve` は文字列操作だけで symlink を辿らないので、これだけだとワークスペース配下に見える symlink 経由で `/etc/passwd` 等が読める。**必ず `realpathSync` を通す**。

### ユーザー入力パスの結合は `path.resolve`、`path.join` を避ける

`path.join(process.cwd(), userInput)` は、`userInput` が絶対パスの場合に壊れる：

```ts
// ❌ 絶対パスが連結されて壊れる
path.join(process.cwd(), '/custom/path')  // → '/Users/xxx/project/custom/path'

// ✅ 絶対パスはそのまま、相対パスは cwd 基準で解決
path.resolve(process.cwd(), '/custom/path')  // → '/custom/path'
path.resolve(process.cwd(), 'relative')      // → '/Users/xxx/project/relative'
```

### コマンドインジェクション防御

`execFile` / `spawn` の **引数配列** にユーザー入力を渡すのは OK（シェルを経由しない）。`exec` や `execSync` のように shell 経由で実行する関数は使わない：

```ts
// ✅ execFile + 配列引数
execFile('code', ['--goto', `${resolved}:${line}`])

// ❌ exec / shell 経由
// exec(`code --goto ${userInput}`)
```

### ユーザー入力 RegExp のフラグ剥がし

ユーザー / 設定ファイル由来の RegExp で `g` または `y` フラグが付くと、`test()` が `lastIndex` を保持してステートフルになり、同じ入力に対して true / false が交互に切り替わる罠がある：

```ts
// ✅ ステートフルにするフラグだけ剥がす
const safeFlags = userPattern.flags.replace(/[gy]/g, '')
const regex = new RegExp(`^(?:${userPattern.source})$`, safeFlags)
```

### runtime.ts のセキュリティ観点

ユーザーアプリのブラウザコンテキストに注入される `runtime.ts` は、特にレビューを厳しくする：

- `window` グローバルへの書き込みは `window.__SVELTE_DEVTOOLS__` 名前空間に集約されているか
- `Object.prototype` / `Array.prototype` などビルトインを拡張していないか
- `eval` / `new Function` を使っていないか
- ユーザーコードから来るオブジェクトを `JSON.stringify` する時に循環参照を考慮しているか
- 注入される変数名がユーザーコードと衝突しないようプレフィックス付き（`__svelte_devtools_*`）になっているか

---

## production への副作用なし（dev only 原則）

このプラグインは **dev mode only** で動作するべきで、production ビルドにも、ユーザーが production を回した時の挙動にも影響を与えてはいけない。

### Vite プラグインフックでのガード

```ts
// ✅ serve コマンドのみで動作
transformIndexHtml() {
  if (config.command !== 'serve') return []
  return [/* ... */]
}

transform(code, id) {
  if (config?.command !== 'serve') return null
  // ...
}
```

新しいフック / transform を追加する時は、**`config.command === 'serve'`（または `config.command !== 'serve'` で early return）のガードを必ず入れる**。

### resolveId / load の挙動

仮想モジュール（`virtual:svelte-devtools/runtime` 等）を resolveId で intercept する場合、importer が `node_modules` 配下や Vite の internal モジュール（`\0` プレフィックス）からの import である時は intercept しない。これを忘れると `node_modules` 内のコードが書き換わって壊れる：

```ts
resolveId(id, importer) {
  if (
    config?.command === 'serve' &&
    componentTracking &&
    id === 'svelte/internal/client' &&
    importer &&
    !importer.includes('node_modules') &&
    !importer.startsWith('\0')
  ) {
    return WRAPPER_MODULE_ID
  }
  return undefined
}
```

---

## HMR チャネル（送受信ペア）

`server.hot.send(name, data)` と `server.hot.on(name, handler)` はペアで存在する必要がある。新しいチャネルを追加する時は **両側を同時に追加** すること。

| 役割 | 送信側 | 受信側 |
|------|--------|--------|
| サーバー → クライアント要求 | `plugin.ts` の `server.hot.send('svelte-devtools:request-*')` | `runtime.ts` の `import.meta.hot?.on('svelte-devtools:request-*')` |
| クライアント → サーバー報告 | `runtime.ts` の `import.meta.hot?.send('svelte-devtools:*')` | `plugin.ts` の `server.hot.on('svelte-devtools:*')` |

レビュー時は、新しい `send` を見つけたら対応する `on` ハンドラが反対側に存在することを確認する。片側だけ追加されていると silent に動かない。

### Promise resolver パターンの正しい使い方

`get-reactive-graph` / `get-state-timeline` のように、HMR で要求 → ブラウザから応答が返るのを待つ非同期パターンでは、**タイムアウト時に resolver 配列から対象 resolver を削除しないと memory leak になる**：

```ts
// ✅ 正しいパターン
return new Promise<T>((resolve) => {
  let resolved = false
  const resolver = (data: T) => {
    if (!resolved) { resolved = true; clearTimeout(timeout); resolve(data) }
  }
  const timeout = setTimeout(() => {
    resolved = true
    // タイムアウト時に resolver を配列から取り除く
    const idx = resolvers.indexOf(resolver)
    if (idx !== -1) resolvers.splice(idx, 1)
    resolve(fallback)
  }, 1000)
  resolvers.push(resolver)
})
```

新規の resolver パターンを追加する時は、必ずタイムアウト時の取り除きが入っているか確認。

---

## バッファ / コレクションのキャパシティ

長時間の dev セッションで状態を蓄積するバッファ（`renderProfiles` / `loadProfiles` / `fpsSamples` / `runtimeErrors` / `compilerWarnings` / `stateTimeline`）には **必ず長さ上限のキャッピング** を入れる：

```ts
// ✅ 一定数を超えたら古い方から捨てる
fpsSamples.push(data)
if (fpsSamples.length > 1200) fpsSamples = fpsSamples.slice(-1200)
```

無制限に push するとメモリリークになる。**`Infinity` をキャパシティに使わない**。

---

## RPC 追加時の整合性チェック

新しい RPC を追加する場合、以下のすべての箇所が同期しているか確認：

1. `src/types.ts` — 入出力の型定義
2. `src/plugin.ts` の `getRpcHandlers()` — サーバー側ハンドラ実装
3. `client/src/lib/types.ts` — クライアント側の型定義（サーバーと同じ shape）
4. `client/src/lib/rpc.ts` — クライアント関数（`getClient().call('svelte-devtools:xxx', ...)` を呼ぶ）
5. （該当パネルがあれば）`client/src/panels/*.svelte` — UI

メソッド名は `'svelte-devtools:xxx'` のプレフィックスで統一されているか。

**1 箇所だけ追加して残りを忘れる** のがありがちなミス。レビュー時は必ず全層を grep して整合を取る。

---

## パフォーマンス観点

### N+1 / O(n²) の検出

```ts
// ❌ ループ内で find / filter（O(n²)）
for (const created of createdItems) {
  const original = originalItems.find((o) => o.name === created.name)
}

// ✅ 事前に Map を構築（O(n)）
const byName = new Map(originalItems.map((o) => [o.name, o]))
for (const created of createdItems) {
  const original = byName.get(created.name)
}
```

特に **module graph / component relations / route 解析** は中規模プロジェクトでファイル数が数百〜数千になるため、ループ内の find / filter は要警戒。

### dev サーバーへの過剰な負荷

- ポーリング頻度が高すぎないか（最小 500ms）
- `transform` フックで重い計算をしていないか（hot-path に乗る）
- `analyzeComponents` / `analyzeRoutes` のように fs を走査する関数を、RPC 呼び出しごとに毎回叩いていないか（必要ならキャッシュ）

### メモリ上のデータアクセスは N+1 ではない

```ts
// ✅ N+1 ではない: メモリ上のオブジェクトのプロパティアクセス
for (const route of routes) {
  for (const file of route.files) { /* ... */ }
}

// ❌ N+1: ループ内で fs / fetch / RPC
for (const file of files) {
  const content = await fs.promises.readFile(file)  // I/O が毎回発生
}
```

ループ内の `await` でも、**メモリ上の Promise を await する** のは N+1 ではない（`Promise.all` の中身など）。実際に I/O / RPC / fetch が発生しているかで判断する。

---

## Svelte 5 リアクティビティ（DevTools UI）

### `$effect` の正しい使い方

```svelte
<script lang="ts">
  // ❌ 初期化処理を $effect に置くと依存変化で再実行される
  $effect(() => { fetchData() })

  // ✅ 初期化はトップレベル
  fetchData()

  // ✅ 依存変化で再実行したい処理だけ $effect
  $effect(() => {
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
  })
</script>
```

### `$effect` のクリーンアップ漏れ

`setInterval` / `setTimeout` / `addEventListener` を `$effect` 内で使う場合、必ず戻り値でクリーンアップする：

```svelte
<script lang="ts">
  $effect(() => {
    const id = setInterval(refresh, 500)
    return () => clearInterval(id)  // ← 必須
  })
</script>
```

DevTools パネルでは **ポーリング (`setInterval(refresh, 500)`)** が頻出する。`onMount` 内で setInterval を作って return でクリアするのも OK だが、cleanup を忘れない。

### 状態の同期は `$derived` を使う

```svelte
<script lang="ts">
  // ❌ $effect で代入
  let displayed = $state<Item[]>([])
  $effect(() => { displayed = items.filter((i) => i.visible) })

  // ✅ $derived
  const displayed = $derived(items.filter((i) => i.visible))
</script>
```

---

## 共通コンポーネントの再利用

`client/src/components/` には以下が既に用意されている。新規パネルでこれらを **再利用しているか**、独自再実装になっていないかをレビュー：

| コンポーネント       | 用途                                           |
| -------------------- | ---------------------------------------------- |
| `PanelContainer`     | 各パネルのルートラッパー（パディング・スクロール） |
| `Card`               | タイトル付きの矩形カード                       |
| `ListItem`           | スクロール可能なリスト項目                     |
| `ScrollList`         | 仮想化されたリスト                             |
| `ActionButton`       | アクションボタン                               |
| `Badge`              | 色付きラベル（success / warning / error）      |
| `SearchInput`        | 検索フォーム                                   |
| `DetailPanel`        | リスト + 詳細の 2 ペイン UI                    |
| `GraphView`          | グラフ可視化（reactive / module graph 用）     |

新規パネルがこれらと同じ責務のコンポーネントを再実装している場合は、既存を使うように指摘する。
逆に、既存に該当がないが新パネル独自で必要な UI は、`components/` に汎用化して切り出すことを検討する。

---

## デザインシステム CSS 変数の使用

`client/src/lib/design-system.css` で定義された変数を使う：

| カテゴリ      | 変数例                                              |
| ------------- | --------------------------------------------------- |
| 色            | `--color-bg` / `--color-text` / `--color-success` 等 |
| スペーシング  | `--space-1` / `--space-2` / `--space-4` 等           |
| 角丸          | `--radius-sm` / `--radius-md` / `--radius-lg`       |
| フォントサイズ | `--text-xs` / `--text-sm` / `--text-base` 等        |
| トランジション | `--transition-fast` / `--transition-base`           |

ハードコードされた色 (`#fff`, `rgb(...)`, `red`) や絶対 px 値 (`padding: 16px`) が混じっている場合は、変数に置き換えるよう指摘する。例外は SVG 内の `stroke` / `fill` 等、CSS 変数が使えない箇所のみ。

---

## テストカバレッジ

### 機能追加の PR

- 新規 RPC ハンドラ → `src/__tests__/plugin.test.ts` に対応テスト
- 新規 analyzer → `src/__tests__/analyzers.test.ts` に対応テスト
- 新規 transform → `src/__tests__/transforms.test.ts` に対応テスト
- runtime.ts の変更 → `src/__tests__/runtime.test.ts`
- セキュリティ系（URL 検証、パス検証、XSS 防止）→ `src/__tests__/security.test.ts` の負例テストを追加
- middleware（`/__svelte-devtools/*` の Express 風ルート）→ `src/__tests__/middleware.test.ts`

### バグ修正の PR

- バグを再現するテストケースを追加（regression 防止）
- 修正後そのテストが pass することを確認

### リファクタリングの PR

- リファクタ対象に既存テストがあること
- なければ先にテストを追加してからリファクタする

### テストコードの品質

- フィクスチャを `src/__tests__/fixtures` に集約しているか（散在させない）
- 外部 fetch をモックしているか（実ネットワークアクセスを避ける）
- コメントとアサーションが矛盾していないか

```ts
// ❌ コメントと矛盾
// 削除されていないことを確認
expect(items.find((i) => i.id === target.id)).toBeUndefined()

// ✅ 整合
// 削除されていないことを確認
expect(items.find((i) => i.id === target.id)).toBeDefined()
```

---

## API サーフェスと後方互換性

### `SvelteDevtoolsOptions` の追加

新しいオプションを追加する場合：

- 既存の動作を壊さないデフォルト値を設定
- README.md の "Options" セクションに追記
- 型定義（`src/plugin.ts` または `src/types.ts`）にコメントを書く

```ts
export interface SvelteDevtoolsOptions {
  /**
   * Enable component tracking via code injection.
   * @default true
   */
  componentTracking?: boolean

  /**
   * 新しいオプション（用途を明記）
   * @default <デフォルト>
   */
  newOption?: boolean
}
```

### RPC の名前変更 / 削除

破壊的変更（v0.0.x なので許容はされるが）。
- 既存の RPC 名を変更する場合、client 側 (`client/src/lib/rpc.ts`) と panel が同時に更新されているか確認
- HMR チャネル名の変更も同様

---

## DRY の遵守

### バリデーションロジックの重複

```ts
// ❌ 各ハンドラで同じ URL バリデーションを重複実装
'svelte-devtools:get-og-preview': async (url) => {
  if (!url.startsWith('http')) throw new Error(...)
  // ...
},
'svelte-devtools:send-api-request': async (url) => {
  if (!url.startsWith('http')) throw new Error(...)
  // ...
}

// ✅ 共通の `validateExternalUrl` を使う
'svelte-devtools:get-og-preview': async (url) => {
  validateExternalUrl(url)
  // ...
}
```

### 変換ロジックの重複

`analyzeComponents` / `analyzeRoutes` のような fs 走査関数を呼び出す箇所が複数あるなら、結果をキャッシュするか共通化する。

---

## ESLint disable / 型キャスト

- `eslint-disable` を安易にコピーしない。**明確な技術的理由**をコメントで添える
- `as unknown as T` のような二段キャストは禁止（型安全性が壊れる）
- 「型推論がうまくいかない」「なぜかエラーになる」は技術的理由ではない。根本原因を調査する

---

## コードコメント

- コメントは日本語または英語、既存ファイルのスタイルに合わせる
- WHAT を書かない（コード自体が説明する）
- WHY を書く（背景、トレードオフ、ハマりやすい罠）

```ts
// ❌ WHAT（不要）
// FPS samples を 1200 件まで保持
if (fpsSamples.length > 1200) fpsSamples = fpsSamples.slice(-1200)

// ✅ WHY（背景があるなら書く）
// dev セッションが長時間続いてもメモリリークにならないよう、最後の N 件のみ保持。
// 1200 件 = 0.5 秒間隔で 10 分相当。UI チャートの可視範囲もこの程度。
if (fpsSamples.length > 1200) fpsSamples = fpsSamples.slice(-1200)
```

---

## レビュー時の最終チェックリスト

```markdown
【セキュリティ】
✅ 外部 URL fetch に validateExternalUrl を通しているか？
✅ ファイルサーブで realpathSync + prefix チェックを入れているか？
✅ ユーザー入力パスは path.resolve を使っているか？
✅ execFile の引数配列形式を使っているか？
✅ ユーザー入力 RegExp の g/y フラグを剥がしているか？
✅ runtime.ts が window グローバルを汚していないか（__SVELTE_DEVTOOLS__ 名前空間）？

【dev only】
✅ 新規プラグインフックに config.command === 'serve' のガードがあるか？
✅ resolveId の intercept が node_modules / \0 を除外しているか？
✅ production バンドルに runtime / wrapper が混入しないか？

【HMR / RPC】
✅ 新規 server.hot.send に対応する on ハンドラがあるか（逆も同様）？
✅ Promise resolver のタイムアウト時 splice があるか？
✅ 新規 RPC が types.ts / plugin.ts / client lib types.ts / client rpc.ts 全層に追加されているか？

【パフォーマンス】
✅ ループ内 find/filter（O(n²)）がないか？ Map で逆引きしているか？
✅ ポーリング頻度が 500ms 以上か？
✅ バッファに長さキャップがあるか（slice(-N)）？

【UI（client）】
✅ Svelte 5 で $effect 内に初期化を置いていないか？
✅ $effect の cleanup（setInterval / addEventListener）漏れがないか？
✅ 状態同期は $derived を使っているか？
✅ 共通コンポーネント（Card, ListItem, ...）を再利用しているか？
✅ design-system.css の CSS 変数を使っているか？

【テスト】
✅ 新規 RPC / analyzer / transform / runtime / セキュリティ系に対応テストがあるか？
✅ 外部 fetch をモックしているか？
✅ コメントとアサーションが整合しているか？

【API サーフェス】
✅ SvelteDevtoolsOptions の追加が README に反映されているか？
✅ 破壊的変更（RPC 名変更 / 削除）が必要な層全てに反映されているか？
```

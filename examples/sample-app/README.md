# sample-app — vite-devtools-svelte demo

`vite-devtools-svelte` の各 DevTools パネルを実際に触って体感するための SvelteKit サンプル EC アプリです。

## 起動

リポジトリのルートから:

```bash
pnpm install
pnpm -C packages/vite-devtools-svelte build
pnpm -C examples/sample-app dev
```

ブラウザでアプリを開いたあと、Vite DevTools のドロワーを開き **Svelte** タブから各パネルを確認してください。

## 何を見せるためのアプリか

| パネル              | このアプリでの確認ポイント                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Component Inspector | `Header` / `ProductCard` / `ReactivePriceChart` のツリーを確認                               |
| Render Profiler     | `/dashboard` の `HeavyList` で件数を増やし、再レンダー時間を観察                             |
| Reactive Graph      | `/cart` の `ReactivePriceChart` が `$state → $derived → $effect` の連鎖を描画                |
| Route Viewer        | `/`, `/products`, `/products/[id]`, `/cart`, `/dashboard`, `/api/*` を一覧                   |
| Load Profiler       | `/products` と `/products/[id]`, `/dashboard` の `+page.server.ts` が並列 / 順次 load を発生 |
| State Timeline      | `/cart` で数量を変えると履歴に記録                                                           |
| API Playground      | `/api/products`, `/api/cart` (POST), `/api/stats` の 3 エンドポイント                        |
| FPS Monitor         | ホーム下部の `FpsCanvas` でパーティクル数を上げると FPS が落ちる                             |
| Asset Browser       | `static/favicon.svg`, `static/og-image.svg`                                                  |
| OG Preview          | `+layout.svelte` と `/products/[id]` に OG メタタグ                                          |
| Module Graph        | カートのストア (`cart.svelte.ts`) を中心に依存グラフを観察                                   |

## 構成

```
src/
├── app.html / app.css
├── lib/
│   ├── components/
│   │   ├── Header.svelte
│   │   ├── ProductCard.svelte
│   │   ├── ReactivePriceChart.svelte   # 料金内訳：$derived 連鎖
│   │   ├── FpsCanvas.svelte            # requestAnimationFrame で描画
│   │   └── HeavyList.svelte            # 件数可変の大量リスト
│   ├── stores/cart.svelte.ts           # $state ベースのカートストア
│   └── server/products.ts              # 商品マスタ（インメモリ）
└── routes/
    ├── +layout.svelte
    ├── +page.svelte                    # ランディング
    ├── products/
    │   ├── +page.svelte / +page.server.ts
    │   └── [id]/+page.svelte / +page.server.ts
    ├── cart/+page.svelte
    ├── dashboard/+page.svelte / +page.server.ts
    └── api/
        ├── products/+server.ts         # GET
        ├── cart/+server.ts             # POST
        └── stats/+server.ts            # GET
```

## vite.config.ts

```ts
import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { svelteDevtools } from 'vite-devtools-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})
```

`svelteDevtools()` は `sveltekit()` より **前** に置く必要があります（Svelte コンパイラが走る前に runes ラッパを差し込むため）。

# kit-shop: vite-devtools-svelte demo

A SvelteKit 3 demo shop for trying each DevTools panel by hand.

## Start

From the repository root:

```bash
pnpm install
pnpm build
pnpm -C examples/kit-shop dev
```

Open the app, open the Vite DevTools drawer and check each panel from the **Svelte** tab.

## What it shows

| Panel          | What to check in this app                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Components     | The tree of `Header` / `ProductCard` / `ReactivePriceChart`                                               |
| Render         | Raise the count of `HeavyList` on `/dashboard` and watch re-render times                                  |
| Reactivity     | `ReactivePriceChart` on `/cart` draws a `$state → $derived → $effect` chain                               |
| Routes         | Lists `/`, `/products`, `/products/[id]`, `/cart`, `/dashboard`, `/api/*`                                 |
| Load functions | The `+page.server.ts` of `/products`, `/products/[id]` and `/dashboard` run parallel and sequential loads |
| State timeline | Changing quantities on `/cart` records history                                                            |
| API            | 3 endpoints: `/api/products`, `/api/cart` (POST), `/api/stats`                                            |
| Frame rate     | Raising the particle count of `FpsCanvas` at the bottom of the home page drops the FPS                    |
| Assets         | `static/favicon.svg`, `static/og-image.svg`                                                               |
| Social preview | OG meta tags in `+layout.svelte` and on `/products/[id]`                                                  |
| Modules        | The dependency graph around the cart store (`cart.svelte.ts`)                                             |

## Layout

```
src/
├── app.html / app.css
├── lib/
│   ├── components/
│   │   ├── Header.svelte
│   │   ├── ProductCard.svelte
│   │   ├── ReactivePriceChart.svelte   # price breakdown: a $derived chain
│   │   ├── FpsCanvas.svelte            # draws with requestAnimationFrame
│   │   └── HeavyList.svelte            # a long list with a variable count
│   ├── stores/cart.svelte.ts           # $state-based cart store
│   └── server/products.ts              # product data (in memory)
└── routes/
    ├── +layout.svelte
    ├── +page.svelte                    # landing
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
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  devtools: { apply: 'serve' },
  plugins: [svelteDevtools(), sveltekit({ adapter: adapter() })],
});
```

`svelteDevtools()` must come **before** `sveltekit()`, so the runes wrappers are added before the Svelte compiler runs.

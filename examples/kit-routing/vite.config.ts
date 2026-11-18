import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

// Shared by every example (scripts/examples.mjs sets these):
// SVELTE_DEVTOOLS_DOCK=1 adds @vitejs/devtools, so the Svelte panels mount in its
// dock; otherwise the plugin serves /.svelte-devtools/ itself (standalone).
// SVELTE_DEVTOOLS_CLIENT_AUTH=0 turns the one-time code off (localhost only).
const dock = process.env.SVELTE_DEVTOOLS_DOCK === '1';
const clientAuth = process.env.SVELTE_DEVTOOLS_CLIENT_AUTH !== '0';

export default defineConfig(async () => ({
  plugins: [
    svelteDevtools({ clientAuth }),
    ...(dock ? [(await import('@vitejs/devtools')).DevTools({ clientAuth })] : []),
    sveltekit({
      adapter: adapter(),
      // Only /pricing opts into prerendering; don't crawl the nav from it (it links
      // to pages that 404/418/500 on purpose).
      prerender: { crawl: false },
    }),
  ],
}));

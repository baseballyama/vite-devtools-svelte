import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
// Plain Svelte + Vite (no SvelteKit). `SVELTE_DEVTOOLS_DOCK=1` adds `@vitejs/devtools`
// (the plugin then mounts into its dock); otherwise the plugin serves
// /.svelte-devtools/ itself (standalone).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const dock = process.env.SVELTE_DEVTOOLS_DOCK === '1';

// SVELTE_DEVTOOLS_CLIENT_AUTH=0 (set by scripts/examples.mjs) turns the one-time code off.
const clientAuth = process.env.SVELTE_DEVTOOLS_CLIENT_AUTH !== '0';

export default defineConfig(async () => ({
  plugins: [
    svelteDevtools({ clientAuth }),
    ...(dock ? [(await import('@vitejs/devtools')).DevTools({ clientAuth })] : []),
    svelte(),
  ],
}));

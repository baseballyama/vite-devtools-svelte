import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Loaded by server.js (createServer in middleware mode), not by `vite dev`.
// SVELTE_DEVTOOLS_DOCK=1 adds @vitejs/devtools, so the Svelte panels mount in its
// dock; otherwise the plugin serves /.svelte-devtools/ itself (standalone).
// SVELTE_DEVTOOLS_CLIENT_AUTH=0 turns the one-time code off (localhost only).
const dock = process.env.SVELTE_DEVTOOLS_DOCK === '1';
const clientAuth = process.env.SVELTE_DEVTOOLS_CLIENT_AUTH !== '0';

export default defineConfig(async () => ({
  plugins: [
    svelteDevtools({ clientAuth }),
    ...(dock ? [(await import('@vitejs/devtools')).DevTools({ clientAuth })] : []),
    svelte(),
  ],
}));

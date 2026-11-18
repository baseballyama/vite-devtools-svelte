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
      paths: { base: '/base' },
      appDir: '_custom_app',
      // Deliberately the deprecated (still supported) option: this example checks
      // the DevTools against a routes directory other than src/routes.
      // oxlint-disable-next-line typescript/no-deprecated
      files: { routes: 'src/app-routes' },
      embedded: true,
    }),
  ],
}));

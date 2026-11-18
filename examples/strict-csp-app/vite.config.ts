import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { DevTools } from '@vitejs/devtools';
import { defineConfig } from 'vite';

// SVELTE_DEVTOOLS_CLIENT_AUTH=0 (set by scripts/examples.mjs) turns the one-time code off.
const clientAuth = process.env.SVELTE_DEVTOOLS_CLIENT_AUTH !== '0';

export default defineConfig({
  plugins: [
    svelteDevtools({ clientAuth }),
    DevTools({ clientAuth }),
    sveltekit({
      adapter: adapter(),
      // Strict CSP — designed to surface every cross-origin request that
      // `@vitejs/devtools` and `vite-devtools-svelte` perform at runtime.
      //
      // SvelteKit applies these directives via a meta http-equiv in dev too,
      // so the browser enforces them against everything injected into the page,
      // including DevTools' transformIndexHtml injection.
      csp: {
        mode: 'nonce',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'connect-src': ['self', 'ws://localhost:*', 'http://localhost:*'],
          'img-src': ['self', 'data:'],
          'font-src': ['self', 'data:'],
          'object-src': ['none'],
          'base-uri': ['self'],
        },
      },
    }),
  ],
});

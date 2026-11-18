import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

// SVELTE_DEVTOOLS_CLIENT_AUTH=0 (set by scripts/examples.mjs) turns the one-time code off.
const clientAuth = process.env.SVELTE_DEVTOOLS_CLIENT_AUTH !== '0';

export default defineConfig({
  devtools: { apply: 'serve', clientAuth },
  plugins: [
    svelteDevtools({ clientAuth }),
    sveltekit({
      adapter: adapter(),
      // Strict, to surface every cross-origin request the DevTools make. SvelteKit
      // applies it via a meta http-equiv in dev too, so it also covers what
      // DevTools inject through transformIndexHtml.
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

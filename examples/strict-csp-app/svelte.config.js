import adapter from '@sveltejs/adapter-auto'

/**
 * Strict CSP — designed to surface every cross-origin request that
 * `@vitejs/devtools` and `vite-devtools-svelte` perform at runtime.
 *
 * SvelteKit applies these directives via a meta http-equiv in dev too,
 * so the browser enforces them against everything injected into the page,
 * including DevTools' transformIndexHtml injection.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  kit: {
    adapter: adapter(),
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
  },
}

export default config

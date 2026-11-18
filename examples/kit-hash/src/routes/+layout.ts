import type { LayoutLoad } from './$types';

// With the hash router (`router: { type: 'hash' }` in vite.config.ts) the app
// is client-only by construction: the server never sees the route after `#`,
// and page options such as `ssr` are rejected (router_hash_page_options).
// Every load here is therefore a universal load running in the browser.
export const load: LayoutLoad = () => ({ startedAt: new Date().toLocaleTimeString() });

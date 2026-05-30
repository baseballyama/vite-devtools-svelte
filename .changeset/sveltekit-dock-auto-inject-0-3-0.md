---
'vite-devtools-svelte': minor
---

Auto-inject the `@vitejs/devtools` dock into SvelteKit dev pages.

`@vitejs/devtools` injects its dock via Vite's `transformIndexHtml` hook, but SvelteKit's dev server never calls `transformIndexHtml` — it builds the response HTML through its own SSR pipeline. The result was that even with both `svelteDevtools()` and `DevTools()` registered correctly, the dock stayed invisible on every SvelteKit page (#51).

The plugin now ships a `transform` hook against the file SvelteKit emits to inline `app.html` (`.svelte-kit/generated/server/internal.js`), rewriting the embedded app template literal to include the inject script. That file goes through Vite's module pipeline (`vite.ssrLoadModule`), so the regular `transform` hook reaches it. No upstream changes and no user code changes are required.

> Note: the code for this feature actually shipped silently in `0.2.1` — a missing minor changeset caused that release to be cut as a patch. `0.3.0` corrects the version line so the new capability is discoverable through semver.

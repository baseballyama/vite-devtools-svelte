# kit-hash: hash router (`router.type: 'hash'`)

A SvelteKit app with `router: { type: 'hash' }`. URLs look like `/#/notes/hash-router`, and the server only ever receives `/`. With the hash router, page options (`ssr` and so on) are an error (`router_hash_page_options`), so the routes set none. By design the app is client only, and every load is a universal load that runs in the browser. It builds with `adapter-static` (no fallback; `build/index.html` is the shell).

| Route (`#/…`)    | What it shows                                                          |
| ---------------- | ---------------------------------------------------------------------- |
| `#/`             | `+page.ts`, a `$state` that grows on click                             |
| `#/notes`        | Nested layout (`notes/+layout.ts` loads the list, a `$derived` filter) |
| `#/notes/[slug]` | Dynamic param, `await parent()`, an unknown slug is `error(404)`       |
| `#/about`        | Programmatic navigation with `goto('#/notes/…')`                       |

## Checklist

- [ ] Routes: the file-based routes (`/`, `/about`, `/notes`, `/notes/:slug`) are listed, independent of the hash URLs
- [ ] Load functions: every load is `universal`, recorded under its route ID (`/notes/[slug]` and so on). Navigating `#/notes/a` → `#/notes/b` adds entries
- [ ] Components: `#/notes/…` shows three levels, `+layout` > `+layout` (notes) > `+page`. Moving between notes does not remount the notes layout
- [ ] Svelte Inspector: right-click an element and press Inspect to select its component (hash URLs are fine)
- [ ] Dock mode (`SVELTE_DEVTOOLS_DOCK=1`) shows the dock too

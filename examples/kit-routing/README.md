# kit-routing: every routing and data loading pattern

A SvelteKit 3 (SSR) app that walks through routing, `load`, form actions, endpoints and hooks. Use it to check the **Routes / Load functions / API / Components / Problems** panels.

```bash
pnpm examples kit-routing        # http://localhost:5206/ (from the repository root)
pnpm examples kit-routing --dock # inside the Vite DevTools dock
```

## Routes

| URL                              | Route ID / file                                                           | What to check                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/`                              | `+layout.server.ts` (root)                                                | The server load that runs first on every page                                                                                       |
| `/about`, `/contact`, `/pricing` | `(marketing)/…` + `(marketing)/+layout.svelte`                            | The group is not in the URL. `/contact` has only a default action. `/pricing` is `prerender = true`                                 |
| `/landing`                       | `(marketing)/landing/+page@.svelte`                                       | Layout reset (skips the marketing layout)                                                                                           |
| `/legacy-about`                  | `reroute` in `src/hooks.ts`                                               | The URL stays, and `/about` renders                                                                                                 |
| `/dashboard`                     | `(app)/+layout.server.ts` → `+layout.ts` → `+page.server.ts` → `+page.ts` | Four kinds of load in one chain. `await parent()` runs them in order; server loads run in parallel                                  |
| `/dashboard`                     | Same                                                                      | Streaming (an un-awaited Promise), `depends('app:clock')` + `invalidate` / `refreshAll()`, a `Money` class sent through `transport` |
| `/dashboard/fail`                | `(app)/dashboard/+error.svelte`                                           | `error(503)` → nested `+error.svelte` (the (app) layout stays)                                                                      |
| `/settings`                      | `(app)/settings/+page.server.ts`                                          | Named actions `?/profile` and `?/newsletter`, `fail()`, `use:enhance`, `snapshot()`                                                 |
| `/admin/reports`                 | `(app)/admin/reports/+layout@(app).svelte`                                | Layout reset (skips the admin layout, back to (app))                                                                                |
| `/blog`                          | `blog/+page.js`                                                           | A `.js` load file                                                                                                                   |
| `/blog/[slug]`                   | `blog/[slug]/+page.server.ts`                                             | A normal param; an unknown slug is a 404                                                                                            |
| `/lang`, `/lang/ja`              | `lang/[[lang]]`                                                           | Optional param                                                                                                                      |
| `/docs/a/b/c`                    | `docs/[...path]`                                                          | Rest param. The load uses `export { load }` → **not showing in Load functions is correct**                                          |
| `/items/2`                       | `items/[id=integer]` + `src/params.ts`                                    | Matcher (SvelteKit 3 `defineParams`). `/items/abc` matches no route and is a 404                                                    |
| `/items/2`                       | Same                                                                      | `export const ssr = true, load = …` (load in the same statement as other exports) is measured too                                   |
| `/files/report.pdf`              | `files/[name].[ext]`                                                      | Two params in one segment                                                                                                           |
| `/.well-known`                   | `[x+2e]well-known/+server.ts`                                             | Escaped segment (`.`)                                                                                                               |
| `/photos` → click a photo        | `photos/+page.svelte`, `photos/[id=integer]`                              | A modal through shallow routing (`preloadData` + `goto(…, { shallow: true })`)                                                      |
| `/static-only`                   | `static-only/+page.ts`                                                    | `csr = false`: no JS, so no Svelte components show up in the runtime                                                                |
| `/slash`                         | `slash/+page.ts`                                                          | `trailingSlash = 'always'` (308 to `/slash/`)                                                                                       |
| `/old-redirect`                  | `old-redirect/+page.server.ts`                                            | `redirect(307)` inside load → not measured                                                                                          |
| `/broken`, `/crash`              | `broken/+page.server.ts`, `crash/+page.ts`                                | `error(418)` (expected error) and an unexpected throw (through `handleError`, on server and client)                                 |
| `/api-console`                   | `api/items`, `api/text`, `api/stream`                                     | GET/POST/PUT/PATCH/DELETE/OPTIONS + `fallback` (PROPFIND), JSON, text and streaming responses                                       |

Hooks: `hooks.server.ts` (`handle` built with `sequence`, `handleFetch` adding a header to `/api/*`, `handleError`), `hooks.client.ts` (`handleError`), `hooks.ts` (`reroute`, `transport`).

## Checklist

- [ ] **Routes**: every route in the table shows. `(app)` / `(marketing)` are not in the URL, and `/lang/:lang?`, `/docs/*path`, `/items/:id` (matcher `integer`), `/files/:name.:ext` and `/.well-known` are right. The `+page@.svelte` / `+layout@(app).svelte` routes are not missing
- [ ] **Load functions**: a full reload of `/dashboard` lists 5 loads from the server (the root `+layout.server.ts`, the two server loads of `(app)` and `dashboard` in parallel, and the two universal loads in order, each waiting for its parent), then the 2 universal loads again from the browser during hydration
- [ ] **Load functions**: client navigation to `/dashboard` from another page records the server loads and the universal loads that run in the browser
- [ ] **Load functions**: the loads of `/docs/…` (`export { load }`), `/old-redirect`, `/broken` and `/crash` are not recorded. `/blog` (`.js`) and `/items/2` are
- [ ] **Load functions**: "invalidate('app:clock')" reruns `+page.server.ts` and adds an entry
- [ ] **API**: every method of `api/items`, plus `api/text`, `api/stream` and `/.well-known`, is listed and can be called
- [ ] **Components**: on `/admin/reports` the admin layout is not in the tree. In the `/photos` modal, `photos/[id=integer]/+page.svelte` shows as a child of `photos/+page.svelte`
- [ ] **Components**: a full load of `/static-only` gives an empty tree (no JS). Going back to another page restores it
- [ ] **State timeline / Reactivity**: the inputs on `/settings`, the navigation log (`log` in the root layout), the yearly toggle on `/pricing`
- [ ] **Problems**: SvelteKit catches the load error on `/crash` and shows `+error.svelte`, so it is not in Problems (it never becomes a `window` `error`, so this is correct)
- [ ] **Social preview**: the `og:title` of `/blog/hello-world` is picked up
- [ ] With `--dock`, `/__devtools/embedded.js` is injected into the SSR HTML and the dock's Svelte tab opens

# kit-spa: SvelteKit SPA with `ssr = false`

An SPA with `export const ssr = false` in the root `+layout.ts` (`adapter-static` with `fallback: '200.html'`). Nothing renders on the server, so **every load runs in the browser as a universal load**. It checks that the DevTools can measure loads that run in the browser. Data comes from `static/data/*.json` through the load's `fetch`.

| Route         | What it shows                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `/`           | `+layout.ts` (`depends('app:site')`) → `+page.ts` fetches after `await parent()`               |
| `/users`      | The load reruns on the `?role=` search param, filtering with `goto()`, favorites (★)           |
| `/users/[id]` | Dynamic param. An unknown id (`/users/999`) is `error(404)` → `+error.svelte`                  |
| `/live`       | `depends('app:clock')` + `invalidate()` / `refreshAll()`, an automatic invalidate every second |
| `/settings`   | `$state` in a `.svelte.ts` module persisted to localStorage (`src/lib/prefs.svelte.ts`)        |

The layout shows `page` / `navigating` from `$app/state` and a log of `beforeNavigate` / `afterNavigate`.

## Checklist

- [ ] Load functions: every load is recorded as `universal` (0 `server`). `/` shows the layout → page waterfall
- [ ] On `/live`, each invalidate adds an entry for the `/live` load. `refreshAll()` adds one for the layout load too
- [ ] The 404 on `/users/999` (the load throws) is not recorded, and the error page shows
- [ ] Routes: `/`, `/live`, `/settings`, `/users`, `/users/:id` are listed with universal loads
- [ ] Components: each client navigation swaps `+page` and keeps `+layout`
- [ ] Reactivity / State timeline: `prefs` (module state) shows under the module, not under a component. Changing settings and ★ record changes
- [ ] After a page reload, the DevTools follow it as a new page load
- [ ] Dock mode (`SVELTE_DEVTOOLS_DOCK=1`) shows the dock too

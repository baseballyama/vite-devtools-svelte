# kit-config: non-default SvelteKit config

Checks that the DevTools do not assume a default SvelteKit setup. `vite.config.ts` changes:

| Setting                               | Value            | DevTools features it can affect                            |
| ------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `paths.base`                          | `/base`          | Public URLs in Assets, Social preview, API, dock injection |
| `appDir`                              | `_custom_app`    | Client asset URLs                                          |
| `files.routes` (deprecated but works) | `src/app-routes` | Routes analysis, route IDs in Load functions               |
| `embedded`                            | `true`           | Events are handled on the app's parent element             |
| `trailingSlash` (root layout)         | `'always'`       | Route URLs, Social preview                                 |

```bash
pnpm examples kit-config            # http://localhost:5211/base/  (DevTools at http://localhost:5211/.svelte-devtools/)
```

Routes: `/base/` (server load, plus a `POST` to an endpoint), `/base/about/` (universal load), `/base/items/[id]/` (server load, with a 404), `/base/api/echo` (GET / POST `+server.ts`).

## Checklist (results as of 2026-11-17)

- [x] The app runs at `/base/`, and client navigation, the endpoint call and the 404 work
- [x] The DevTools open at `/.svelte-devtools/` whatever the base (`/base/.svelte-devtools/` is a 404)
- [x] In dock mode, `/__devtools/embedded.js` is injected and the dock shows
- [x] **Assets**: the public URL of `static/logo.svg` shows as `/base/logo.svg`, and the preview shows
- [x] **API**: `http://localhost:5211/base/api/echo` can be called when typed in directly
- [x] **Routes**: the routes under `src/app-routes` (from `files.routes`) show
- [ ] **Load functions**: loads are recorded, but every route ID is `/` (directories under `app-routes` are not treated as routes). **Known gap**
- [ ] **API**: the endpoint list is empty (it depends on Routes)
- [ ] **Social preview**: the route list is empty. `http://localhost:5211/` fails on the redirect to `/base`; typing `http://localhost:5211/base/` works. A relative `og:image` URL (`./logo.svg`, the `paths.relative` default) gives no warning

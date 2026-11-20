# examples

Apps for checking `vite-devtools-svelte` by hand. Each app covers one app shape that can change how the DevTools behave: plain Svelte, SvelteKit with SSR, SPA, SSG, remote functions or non-default config, Vite middleware mode, library components, a strict CSP, and so on.

## Start them all

From the repository root:

```bash
pnpm install
pnpm build              # plugin + DevTools UI (the apps read dist)
pnpm examples           # every app, standalone (/.svelte-devtools/)
pnpm examples --dock    # every app, inside the Vite DevTools dock
```

- Each app runs on a fixed port (see the table). Logs go to one terminal, each line prefixed with the app name. Ctrl+C stops them all.
- List app names to start only those, e.g. `pnpm examples kit-spa kit-ssg`. `pnpm examples --list` lists them.
- To make checks faster, this script turns the one-time code off (`SVELTE_DEVTOOLS_CLIENT_AUTH=0`, listening on localhost only). Pass `--auth` to check the auth flow too.
- `--dock` passes `SVELTE_DEVTOOLS_DOCK=1`. `kit-shop` and `kit-strict-csp` always use the dock.

## Apps

| App                                      | Port | Shape                                                 | Main things to check                                                                                                                                                                    |
| ---------------------------------------- | ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [plain-svelte](./plain-svelte)           | 5201 | Svelte + Vite (minimal)                               | Every panel renders correctly in a minimal app, empty states included (the compat smoke profile)                                                                                        |
| [kit-shop](./kit-shop)                   | 5202 | SvelteKit SSR (demo shop)                             | All the usual panels. Source of the screenshots and MCP examples                                                                                                                        |
| [kit-strict-csp](./kit-strict-csp)       | 5203 | SvelteKit with a nonce-based strict CSP               | Dock injection and RPC work under `script-src 'self'`                                                                                                                                   |
| [svelte-features](./svelte-features)     | 5204 | Svelte + Vite (feature coverage)                      | Several mount roots, snippets, dynamic components, boundaries, context, class state, module state, legacy components, a custom element, library components in `node_modules`, many rows |
| [svelte-middleware](./svelte-middleware) | 5205 | Own Node server + Vite middleware mode, SSR + hydrate | Vite without an httpServer (SSE transport), a hydrated tree                                                                                                                             |
| [kit-routing](./kit-routing)             | 5206 | SvelteKit SSR (routing and data coverage)             | Groups, layout resets, every param kind, matchers, escapes, every load kind and waterfalls, streaming, actions, endpoints for every method, hooks, errors                               |
| [kit-remote](./kit-remote)               | 5207 | SvelteKit remote functions + Svelte async             | query / query.batch / form / command / prerender, `await` in templates, pending boundaries                                                                                              |
| [kit-spa](./kit-spa)                     | 5208 | SvelteKit SPA (`ssr = false`)                         | Loads run only in the browser (load tracking over the HMR channel)                                                                                                                      |
| [kit-hash](./kit-hash)                   | 5209 | SvelteKit SPA + hash router                           | Routes, loads and components with `#/…` URLs                                                                                                                                            |
| [kit-ssg](./kit-ssg)                     | 5210 | SvelteKit SSG (adapter-static, `prerender = true`)    | Prerendered pages and endpoints, `entries()`, a `csr = false` page without JS                                                                                                           |
| [kit-config](./kit-config)               | 5211 | SvelteKit with non-default config                     | Each panel under `paths.base`, `appDir`, `files.routes`, `embedded` and `trailingSlash` (the app is at `/base/`)                                                                        |
| [ui-lib](./ui-lib) (not an app)          | —    | Svelte component library                              | Installed with `dependenciesMeta.injected`, so it resolves under `node_modules` and is treated like a published library                                                                 |

Each app's README lists its pages and what to check in each panel.

## Adding an app

Add `"devtoolsExample": { "port": <unused port> }` to `examples/<name>/package.json` and `pnpm examples` picks it up. Also set `"base": "/base/"` if the app is not served at `/`, `"server": "server.js"` if it runs its own server instead of `vite dev` (the server must read `PORT` and listen on localhost only), and `"dock": true` if it always loads `@vitejs/devtools`. In `vite.config.ts`, read `SVELTE_DEVTOOLS_DOCK` and `SVELTE_DEVTOOLS_CLIENT_AUTH` the same way the existing apps do. Name SvelteKit apps with a `kit-` prefix so `pnpm sync:kit` includes them.

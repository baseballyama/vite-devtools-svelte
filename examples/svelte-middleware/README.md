# svelte-middleware: Vite middleware mode + SSR + hydrate

Plain Svelte without SvelteKit, served by its own Node server (`server.js`, only `node:http`). Vite starts with `server.middlewareMode: true`, so it has no `httpServer` of its own and the DevTools talk over the **SSE transport** (the HMR WebSocket rides on the app's server through `hmr.server`). Each request is server rendered with `render()` from `svelte/server` and hydrated in the browser with `hydrate()`.

```bash
pnpm -C examples/svelte-middleware dev          # http://localhost:5205/
SVELTE_DEVTOOLS_DOCK=1 pnpm -C examples/svelte-middleware dev   # Vite DevTools dock
```

In middleware mode the plugin never receives `listening` and so does not print the MCP registration command. `server.js` prints it instead, using the plugin API (`getDevtoolsToken`).

| File                       | Contents                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| `server.js`                | Vite in middleware mode, SSR with `ssrLoadModule` + `transformIndexHtml` |
| `src/entry-server.ts`      | `render()` and the initial props passed from the server                  |
| `src/entry-client.ts`      | `hydrate()` with `window.__INITIAL_PROPS__`                              |
| `src/lib/Counter.svelte`   | `$state` / `$derived` / `$effect` seeded from a server prop              |
| `src/lib/Checklist.svelte` | keyed `#each` + `bind:checked` + `$derived`                              |
| `src/lib/Clock.svelte`     | An `$effect` (timer) that only runs after hydration                      |

## Checklist

- [ ] `/.svelte-devtools/` opens and the header shows **Connected** (over SSE; no WebSocket to `/.svelte-devtools/__ws`)
- [ ] Components: 4 of them, `App` > `Counter` / `Checklist` / `Clock`. The tree is not duplicated after hydration
- [ ] The page shows "hydrated", and the console has no hydration mismatch warning
- [ ] Clicking Counter shows `count` changes in State timeline / Reactivity. Clock's `now` updates every second
- [ ] Render: Clock is recorded as a re-render every second
- [ ] Routes / Load functions: empty states, since this is not SvelteKit
- [ ] Svelte Inspector (Alt+X): right-click an element on the page and press Inspect to select `Counter` and so on
- [ ] Dock mode (`SVELTE_DEVTOOLS_DOCK=1`): the dock shows and the Svelte tab opens
- [ ] The MCP command printed by `server.js` returns 4 entries from `get_live_components`

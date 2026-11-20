# kit-remote: remote functions + Svelte async

An app using SvelteKit **remote functions** (`experimental.remoteFunctions`) and Svelte **async** (`compilerOptions.experimental.async`). It collects the places where the component tree and reactivity look different from a usual app: components with `await` directly in markup or `$derived`, `pending` / `failed` in `<svelte:boundary>`, optimistic updates.

```bash
pnpm examples kit-remote            # http://localhost:5207/
```

| Route          | Features used                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | `query` (no args), `form` (server validation with `invalid()`, `.enhance`, `pending`), `command` + `withOverride` (optimistic update), `.refresh()` |
| `/todo/[id]`   | `$derived(await Promise.all([...]))`, refetch on param change, together with `query.batch`                                                          |
| `/batch`       | `query.batch` (each row's `getUser(id)` is merged into one request), a `<svelte:boundary>` per row                                                  |
| `/errors`      | A query that throws → `failed` snippet, `error(404)` → `reset()`, reading `.error` / `.loading` directly                                            |
| `/live`        | `query.live` (stream subscription, `reconnect()`), `getRequestEvent()`                                                                              |
| `/classic`     | A classic `+page.server.ts` `load` next to a remote `query`                                                                                         |
| `/prerendered` | The `prerender()` function                                                                                                                          |

Remote functions live in `src/lib/todos.remote.ts`, data in `src/lib/server/db.ts` (in memory).

## Checklist

- [ ] **Components**: `+layout` › `+page` › `TodoItem` ×N shows. Adding and removing changes the tree. The slider on `/batch` adds and removes `UserRow`
- [ ] **Components / Reactivity**: `flips` in `TodoItem`, and `all` and `doneCount` (async derived) on `/`, show with values and update when a checkbox changes
- [ ] **State timeline**: toggles, additions and the `/batch` slider record `$state` changes
- [ ] **Render**: the optimistic update (`withOverride`) and the server confirmation are measured as two re-renders
- [ ] **Load functions**: the `+page.server.ts` on `/classic` is recorded (remote function calls are not loads, so for now they do **not** show)
- [ ] **Routes**: 7 routes show (the internal endpoints that `*.remote.ts` adds do not)
- [ ] **Problems**: the failures on `/errors` stay inside the `failed` snippet and do not spill out as unhandled errors
- [ ] **Svelte Inspector** (Alt+X, right-click an element → Inspect): elements rendered late because of `await` still select the right component
- [ ] The same in dock mode (`pnpm examples --dock kit-remote`)

# Implementation checklist

For the Correctness reviewer in Phase 3 of `full-code-review`. Lint (oxlint type-aware, ESLint for Svelte), `tsc`/`svelte-check`, knip and sherif already run in CI; don't report what they catch. Check each item against the code: if a referenced file or helper has moved, find its replacement rather than trusting this list.

Priority: security > effect on production > correctness > performance > readability.

## Security

- Outbound requests from user input (API playground, OG preview) go through `validateExternalUrl` or its DNS-resolving variant in `src/server/security.ts`. Look for redirects or a second fetch that skips the check.
- Files served or read from request input go through `resolveWithinRoot` (symlinks resolved with `realpathSync`, then a root-prefix check). `path.resolve` alone does not follow symlinks.
- Child processes: `execFile`/`spawn` with an argument array, never a shell string.
- A RegExp built from input drops `g`/`y` (stateful `test()`) and cannot backtrack catastrophically.
- New HTTP endpoints are behind the standalone one-time code or the MCP token.

## Browser runtime (`src/runtime/`)

- Runs in the user's page on every component: no work on the hot path that is not needed, no throw that can reach the app, no globals beyond `window.__SVELTE_DEVTOOLS__`, no prototype changes.
- Values from the app are serialized defensively: cycles, getters that throw, huge or deep values (bounded).
- Destroyed components, effects and `{#each}` item state are released, so nothing keeps the app's objects alive.
- The wrapper depends on the shape of Svelte's compiled output and internals; changes to it need a reactivity test on real compiled components.

## Plugin and server (`src/`)

- Every new Vite hook or transform bails out when not serving; `transform` skips `node_modules`, SSR and virtual (`\0`) ids where relevant.
- HMR events: added to `HOT_EVENTS`, both `send` and `on` present, payloads validated on receipt (they come from the page). Request/reply waits time out and remove the pending entry.
- RPC functions: zod-validated arguments, typed results in `src/types.ts` mirrored by `packages/client/src/lib/types.ts`, client wrapper in `rpc.ts`.
- Datasets that grow over a dev session are capped (`Ring` or equivalent) and report truncation through `CaptureInfo`.
- Expensive scans (`analyze*`, module graph) are not repeated per call without need; no O(n²) lookups over modules, components or routes (use a `Map`).
- Dev-server restarts and multiple servers (`middlewareMode`) do not leak listeners, intervals or mounts; `dispose` paths are complete.

## UI (`packages/client`)

- Svelte 5 runes: derive with `$derived`, not `$effect` + assignment; `$effect` only for side effects, with cleanup for timers and listeners; initialization not inside `$effect`.
- Panels are registered in `lib/panels.ts`; existing components (`Panel`, `DataTable`, `VirtualList`, `TreeView`, `SplitView`, `SearchField`, `Button`, `Badge`, `EmptyState`, …) are reused, not re-implemented.
- Colors, spacing and type sizes use `design-system.css` tokens; check both themes.
- Large lists are virtualized or capped; polling, if any, is not tighter than the data changes.
- Interactive elements are keyboard-accessible and labeled.

## Tests

- New or changed logic has a test at the lowest level that can show the behavior: unit (`packages/*/test`, `*.test.ts`), DOM (`*.dom.test.ts`), real components (`test/reactivity/`), runtime cost (`test/perf/`).
- Bug fixes come with a test that fails without the fix.
- Security checks have negative cases (`test/security.test.ts`).
- No real network access; fixtures live in `test/fixtures`.
- Assertions match the test name and comments; no test that passes when the feature is absent.

## Code

- Comments explain why (constraints, traps), not what the code does; no comments describing a past state of the code.
- No `as unknown as T`; every suppression (`eslint-disable`, `oxlint-disable`, `@ts-expect-error`) states its reason.
- Prefer string APIs or an AST over regular expressions.
- Names and file layout follow the neighbors.

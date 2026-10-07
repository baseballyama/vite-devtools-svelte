---
'vite-devtools-svelte': minor
---

Reactivity tracking reworked and verified against real Svelte components:

- `$effect` / `$effect.pre` nodes now have their dependencies (they were always shown without edges, because Svelte defers a component's top-level effect until mount).
- Reads from the markup (`{expr}`, attributes, `{#if}`/`{#each}` conditions, `<svelte:head>`) are edges to a new per-component **markup** node (`type: 'template'`), so a `$derived` used only in the template is no longer reported as unused.
- Object/array `$state` (proxies, class fields, reassigned objects) now has edges: reads of their properties are attributed to the state node, also across components through props.
- Shared state of `.svelte.js` / `.svelte.ts` modules is tracked (graph, timeline, overview rows with `kind: 'module'`).
- `orphanDeriveds` (MCP `get_reactive_graph_problems`) now means "never evaluated"; a derived read only by an event handler is not listed, and `derived-orphan` is no longer a performance issue. Nodes depending on state devtools does not track (e.g. SvelteKit's `$app/state`) report `untrackedDeps` and are not listed as isolated.
- `{@const}` in `{#each}` items and several instances of a `$state` class no longer overwrite each other's node; nodes of removed items / re-run effects leave the graph and counts.
- A component whose init throws inside `<svelte:boundary>` no longer leaves a ghost instance or misattributes later components.
- The runtime script injected into `index.html` (plain Svelte + Vite) no longer fails to load with a CORS error.

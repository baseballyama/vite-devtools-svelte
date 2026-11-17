---
'@sveltejs/vite-devtools-svelte': minor
---

Track components, signals and effects through Svelte's devtools events (`svelte/internal/devtools`) instead of wrapping `svelte/internal/client`. The plugin adds its listener to the compiler's `experimental.devtools` option, so every client component imports it first. Requires a Svelte build with the devtools channel (not released yet).

`$state` changes are read when Svelte applies the batch that wrote them, instead of checking every 200 ms: several writes in one flush are one timeline entry, deep mutations of large values are no longer delayed by about 1 s, and an idle app does no work. The summary and timeline report `policy: 'per-flush'`.

The `componentTracking` option is removed: component tracking is always on in development. The runtime no longer installs the `window.__SVELTE_DEVTOOLS__` global.

The Components overview (and the `get_reactive_summary` MCP tool) now lists the live component instances with their totals since each one mounted, instead of the last 10 seconds, so activity no longer disappears after a pause. Each row shows when the instance was last active; a destroyed instance leaves the overview with its counts. The `windowMs` argument and the `window` field are removed; `computedAt` says when the answer was computed. State created in an `{#each}` item or an effect run leaves the reactive graph as soon as Svelte destroys it.

The Load functions panel now also records loads that run in the browser (universal loads after hydration, and every load of an app with `ssr = false`); before, only loads run on the server were shown.

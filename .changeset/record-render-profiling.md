---
'vite-devtools-svelte': minor
---

Record per-component render counts and render times in the Render tab. The profiling APIs (`recordRender` / `recordRenderTime`) existed but had no call sites, so renders always showed 0. The `svelte/internal/client` wrapper now instruments `template_effect` / `deferred_template_effect` (skipping the initial mount-time run, pooling durations per microtask flush) and wraps block helpers (`each` / `if` / `key` / `await` / `component` / `boundary`) so effects created during batch flushes — e.g. `{#each}` items added later or re-created `{#if}` branches — are attributed to their owning component. Profiles and reactive-node snapshots are now also cleaned up on unmount, so the Render tab no longer accumulates stale rows after client-side navigation.

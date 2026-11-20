---
'@sveltejs/vite-devtools-svelte': patch
---

The in-page runtime now cleans up bookkeeping for destroyed reactive nodes while DevTools is closed, and spends at most about 1/20 of the main thread serializing a large state that keeps changing.

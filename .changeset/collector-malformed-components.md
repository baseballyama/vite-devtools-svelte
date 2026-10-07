---
'vite-devtools-svelte': patch
---

A component snapshot entry that is not an object with a numeric `id` (e.g. `null` from an out-of-spec runtime) is ignored instead of being listed as a live component.

---
'vite-devtools-svelte': patch
---

Build panel: removed the Modules column and the module list in the chunk details. The build output on disk does not say which modules a chunk contains, so they always showed 0 and an empty list. The details now show the chunk's size and its share of the total.

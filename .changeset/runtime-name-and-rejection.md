---
'vite-devtools-svelte': patch
---

Component names drop only the trailing `.svelte` (`Item.sveltekit.svelte` is no longer shown as `Itemkit.svelte`), and an unhandled rejection whose reason cannot be converted to a string no longer makes the devtools listener throw.

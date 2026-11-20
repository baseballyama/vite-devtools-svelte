---
'@sveltejs/vite-devtools-svelte': patch
---

The DevTools UI no longer runs a frame loop while the Reactivity graph is hidden, fetches each Reactivity scope once, and stops re-analyzing components on every tree row change (the tree inspector now has a Re-analyze button). A theme picked in the UI now stays when the OS theme changes.

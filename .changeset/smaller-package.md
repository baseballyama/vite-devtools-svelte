---
'@sveltejs/vite-devtools-svelte': patch
---

The package is about a third smaller: it no longer ships source maps or internal type files, and the browser runtime it injects in dev is minified. The plugin's own code is no longer minified, so its stack traces stay readable.

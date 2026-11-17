---
'@sveltejs/vite-devtools-svelte': patch
---

The API playground detects handlers exported through destructuring and `export *` chains (`$lib` aliases included). An endpoint whose exports cannot all be followed is marked `?` and offers every HTTP method. `ApiEndpoint` gains `complete`.

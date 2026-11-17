---
'@sveltejs/vite-devtools-svelte': patch
---

The API playground now finds handlers exported through destructuring (`export const { GET, POST } = handlers`), classes, and `export * from` chains. Those chains are resolved through the dev server, `$lib` aliases included. An endpoint whose exports cannot all be followed, such as an `export *` from a package or an unreadable module, is marked with `?` and offers every HTTP method.

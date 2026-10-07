---
'vite-devtools-svelte': patch
---

Compiler warnings are now captured: they are taken from vite-plugin-svelte's `onwarn` as structured warnings (code, file, line, column) instead of being parsed out of Vite's logger, which vite-plugin-svelte's dev warnings never reach. A component compiled for both client and SSR lists each warning once.

SvelteKit load profiling finds the exported `load` with a parser instead of text matching: an `export const load` mentioned in a comment or string no longer breaks the module, names declared together with `load` (`export const ssr = false, load = …`) stay exported, and the route is taken from `<root>/src/routes` (a project path containing `routes` no longer garbles it).

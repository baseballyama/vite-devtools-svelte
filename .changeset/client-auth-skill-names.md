---
'vite-devtools-svelte': minor
---

- New `clientAuth` option: `svelteDevtools({ clientAuth: false })` turns off the one-time code for the standalone DevTools on a trusted single-user machine (default `true`). In the Vite DevTools dock, use `DevTools({ clientAuth: false })` from `@vitejs/devtools`.
- The shipped skills are renamed `vite-devtools-svelte-perf-audit` and `vite-devtools-svelte-perf-fix` (they were `vite-devtools-svelte:perf-audit` / `:perf-fix`). The new names follow the Agent Skills spec, so agents such as pi that reject `:` can load them. Re-copy the skills into `.claude/skills/` and call them by the new names.

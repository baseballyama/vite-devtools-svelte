---
'@sveltejs/vite-devtools-svelte': minor
---

feat: add the Svelte Inspector

- It runs in the Vite DevTools dock once the browser is authorized there, and does nothing without `@vitejs/devtools`. `inspector: false` leaves it out.
- With Vite DevTools, the dev server now fails to start when vite-plugin-svelte's own inspector is on too (`vitePlugin.inspector`, or `SVELTE_INSPECTOR_OPTIONS` / `SVELTE_INSPECTOR_TOGGLE` in the shell or an env file). Turn that one off, or pass `inspector: false`.
- `svelte` is now a peer dependency (`^5.46.4`).

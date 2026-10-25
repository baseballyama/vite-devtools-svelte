---
'vite-devtools-svelte': minor
---

- SvelteKit 2 and 3 are both supported, and `@sveltejs/kit` is now declared as an optional peer dependency (`^2.0.0 || ^3.0.0`). Plain Svelte + Vite apps without SvelteKit keep working.
- The plugin now uses `@vitejs/devtools-kit` 0.8. To show the panels inside the Vite DevTools dock, install `@vitejs/devtools` 0.8.0 or later.

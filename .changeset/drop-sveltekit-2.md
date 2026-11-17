---
'vite-devtools-svelte': minor
---

Drop SvelteKit 2 support. The optional `@sveltejs/kit` peer dependency is now `^3.0.0`, and the Vite DevTools dock is injected only into SvelteKit 3's generated dev server module (`.svelte-kit/generated/dev/server.js`); SvelteKit 2's `generated/server/internal.js` is no longer patched. Plain Svelte + Vite apps without SvelteKit keep working.

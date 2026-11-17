---
'@sveltejs/vite-devtools-svelte': minor
---

Include the Svelte Inspector. `svelteDevtools()` now returns a fork of vite-plugin-svelte's inspector among its plugins: hold `alt-x` in your app and click an element to open its source in your editor. Configure it with the new `inspector` option (same options as vite-plugin-svelte's inspector), or set `inspector: false` to leave it out. While it is on, it turns off vite-plugin-svelte's built-in inspector. With Vite DevTools in your Vite config, the inspector lives in its dock instead: a **Svelte Inspector** button and command toggle it, and a **Svelte Inspector settings** view saves your personal shortcut and keys to `.env.local`. `svelte` is now a peer dependency, as the inspector's Svelte components are compiled by your app.

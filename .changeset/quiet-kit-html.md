---
'@sveltejs/vite-devtools-svelte': patch
---

The plugin no longer uses the `transformIndexHtml` hook, so SvelteKit stops warning about it (`transform_index_html_unsupported`). Nothing to change on your side.

---
'vite-devtools-svelte': minor
---

Add an opt-in prompt toolbar: enable it with `svelteDevtools({ promptToolbar: true })` and a draggable button appears in your own pages, where picking elements and writing a request copies one markdown prompt with each element's source location, component chain, props and live `$state`.

Dev only (served by a dev middleware, never in a build); no global keyboard shortcut; details in the README.

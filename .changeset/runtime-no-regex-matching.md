---
'vite-devtools-svelte': patch
---

Component tracking no longer corrupts markup when a line of a component's text starts with `$.push($$props` (e.g. inside `<pre>`), and the reactive graph now attributes reads of object keys containing a quote or backslash (`obj["it's"]`) to the right `$state`.

---
'vite-devtools-svelte': patch
---

Code panes highlight a `<style>` rule whose selector has a pseudo-class (`button:focus-visible {`) as a selector instead of as a `property: value` declaration.

---
'@sveltejs/vite-devtools-svelte': patch
---

The inspector settings say "Couldn't reset" instead of "Couldn't save" when resetting fails, and inspector warnings and debug output use the `[vite-devtools-svelte:inspector]` prefix. The package no longer bundles `obug`; `DEBUG=vite-devtools-svelte:inspector` still turns on debug output.

---
'@sveltejs/vite-devtools-svelte': patch
---

Security: the OG preview checks the address at connection time, closing a DNS rebinding path to the local network. A malformed response now fails the preview instead of crashing the dev server.

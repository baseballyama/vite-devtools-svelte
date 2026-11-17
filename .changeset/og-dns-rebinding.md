---
'@sveltejs/vite-devtools-svelte': patch
---

Security: the OG preview checks the address at connection time, closing a DNS rebinding path to the local network, and also refuses SIIT, local-use NAT64 and Teredo addresses. A malformed response now fails the preview instead of crashing the dev server. The preview sends a browser-like User-Agent, reads compressed pages, and reads pages up to 5 MB.

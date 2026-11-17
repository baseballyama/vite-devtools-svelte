---
'vite-devtools-svelte': patch
---

Security: the OG preview checks the address it connects to, not just the one a name resolved to a moment earlier. The check used to resolve the name and then let `fetch` resolve it again. A name answering with a public address first and a private one second (DNS rebinding) could therefore reach the local network. The preview now requests over `node:http(s)` with a lookup that refuses private addresses at connection time, and uses a fresh connection every time, so no pooled socket skips the check.

---
'vite-devtools-svelte': minor
---

Rebuild the DevTools on [Devframe](https://devfra.me/): the same 15 panels now run **standalone** at `/.svelte-devtools/` on your dev server, or inside the Vite DevTools dock when `@vitejs/devtools` is installed (it is now optional). `svelteDevtools({ componentTracking })` and the MCP endpoint (`/__svelte-devtools/mcp`) are unchanged.

**Breaking (0.x minor):**

- Peer dependency `vite` raised to `^8.3.2` (uses the public `closeServer` hook).
- The HTTP fallback endpoints `/__svelte-devtools/rpc` and `/__svelte-devtools/asset` are removed; the UI talks to the dev server over one Devframe WebSocket RPC (SSE in Vite middleware mode). The Assets panel uses Vite-served public URLs.
- Standalone use is authenticated by default: the first visit from a browser asks for a one-time code printed in the dev-server terminal (or the printed magic link). Trusted-browser tokens are stored in your home directory (`~/.svelte-devtools/devframe/auth.json`) and shared across projects. Inside the Vite DevTools dock, its own authentication applies.

Also: the injected runtime only samples state / FPS while a DevTools tab or MCP agent is watching, sends state-timeline and component changes as deltas, and RPC arguments are schema-validated.

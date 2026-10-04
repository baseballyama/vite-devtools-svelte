---
'vite-devtools-svelte': minor
---

Rebuild the DevTools on [Devframe](https://devfra.me/): the same 15 panels now run **standalone** at `/.svelte-devtools/` on your dev server, or inside the Vite DevTools dock when `@vitejs/devtools` is installed (it is now optional). `svelteDevtools({ componentTracking })` and the MCP endpoint (`/__svelte-devtools/mcp`) keep working as before.

**Breaking (0.x minor):**

- Peer dependency `vite` raised to `^8.3.2` (uses the public `closeServer` hook).
- The HTTP fallback endpoints `/__svelte-devtools/rpc` and `/__svelte-devtools/asset` are removed; the UI talks to the dev server over one Devframe WebSocket RPC (SSE in Vite middleware mode). The Assets panel uses Vite-served public URLs.
- Standalone use is authenticated by default: the first visit from a browser asks for a one-time code printed in the dev-server terminal (or the printed magic link). Trusted-browser tokens are stored in your home directory (`~/.svelte-devtools/devframe/auth.json`) and shared across projects. Inside the Vite DevTools dock, its own authentication applies.

**Reactivity for large apps:** the Reactivity panel opens on a cheap whole-app overview (the busiest components from sampled runtime counters, with what the counts cover) and loads the graph of one component on demand, within node/edge caps. Edges show current dependencies ("can affect"), not a recorded cause. The state timeline never reports the first observation of a signal as a change and says while that baseline is incomplete. Not included yet: which write changed a state, full value inspection, per-signal history, module-level state, dependencies of a component's top-level `$effect`, and render-profile deltas.

**MCP:** all existing tools keep their default output; `get_live_components` accepts `includeMeta` (page-load epoch, totals, limit). Four new tools: `get_reactive_summary`, `get_reactive_scope`, `get_state_timeline` and `get_capture_info`.

**Compatibility:** checked in CI with plain Svelte + Vite, SvelteKit 2 and SvelteKit 3, each standalone and inside the Vite DevTools dock. SvelteKit 3's `#lib` imports and its new dev server template are supported (the dock is now injected on SvelteKit 3).

Also: the injected runtime only samples state / FPS while a DevTools tab or MCP agent is watching, sends state-timeline and component changes as deltas, and RPC arguments are schema-validated.

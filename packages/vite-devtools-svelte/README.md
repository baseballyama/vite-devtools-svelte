# vite-devtools-svelte

Svelte DevTools for Vite, built on [Devframe](https://devfra.me/). Provides 15 specialized panels for debugging, profiling, and inspecting Svelte/SvelteKit applications. The same tool runs **standalone** at `/.svelte-devtools/` on your dev server, or **inside the [Vite DevTools](https://devtools.vite.dev/) dock** when `@vitejs/devtools` is installed.

> **Status:** Early development. APIs may change. This README describes **0.4.0** (Devframe host: standalone or inside the Vite DevTools dock). 0.3.x rendered only inside `@vitejs/devtools`; see [Upgrading from 0.3.x](#upgrading-from-03x).

## Features

- **Component Inspector** — View component hierarchy, props, state, and reactive values in real-time
- **Reactivity** — A whole-app overview of the busiest components, then the current dependencies of one component's `$state`, `$derived` and `$effect` signals (signals created during component init; edges are "can affect", not a recorded cause, and not the complete app graph)
- **Render Profiler** — Track component render counts, render times, and identify bottlenecks
- **Route Viewer** — Explore SvelteKit file-based routing structure with dynamic parameters
- **Load Profiler** — Monitor SvelteKit `load` functions with waterfall visualization
- **State Timeline** — Record and replay state changes across the application
- **API Playground** — Test SvelteKit server endpoints (`+server.ts`) directly from DevTools
- **Error Dashboard** — Centralized view of compiler warnings and runtime errors
- **Code Inspector** — View compiled Svelte output with source mapping
- **Module Graph** — Visualize module dependencies and detect circular imports
- **OG Preview** — Preview Open Graph meta tags for SEO validation
- **Build Analysis** — Analyze build chunks and bundle composition
- **FPS Monitor** — Real-time frame rate monitoring with historical data
- **Asset Browser** — Browse and preview static assets with metadata
- **Overview** — Project summary with versions and dependency info

### Screenshots

Panel shots: captured from the UI in dev-mock mode with synthetic data, before the reactivity update (Social preview: a generated SvelteKit test app). Reactivity shots: captured in CI from the real runtime, against the synthetic demo app in `examples/sample-app`.

<details>
<summary>Overview</summary>

![Overview](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-overview.png)

</details>

<details>
<summary>Components</summary>

![Components](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-components.png)

</details>

<details>
<summary>Routes</summary>

![Routes](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-routes.png)

</details>

<details>
<summary>Assets</summary>

![Assets](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-assets.png)

</details>

<details>
<summary>Render</summary>

![Render](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-profiler.png)

</details>

<details>
<summary>Reactivity</summary>

Overview: what the counts cover and the most active components:

![Reactivity overview](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/reactivity-overview.png)

One component (ReactivePriceChart) and the signals it is directly linked to; edges mean "can affect", not a recorded cause:

![Reactivity, one component](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/reactivity-component.png)

$state signals by sampled changes in the timeline buffer:

![Reactivity, states](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/reactivity-states.png)

After the app page reloads, a selected component id may belong to another instance, and the panel says so:

![Reactivity after a page reload](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/reactivity-epoch.png)

</details>

<details>
<summary>Frame rate</summary>

![Frame rate](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-fps.png)

</details>

<details>
<summary>Load functions</summary>

![Load functions](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-loads.png)

</details>

<details>
<summary>State timeline</summary>

![State timeline](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-timeline.png)

</details>

<details>
<summary>API</summary>

![API](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-api.png)

</details>

<details>
<summary>Problems</summary>

![Problems](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-errors.png)

</details>

<details>
<summary>Compiled output</summary>

![Compiled output](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-inspect.png)

</details>

<details>
<summary>Modules</summary>

![Modules](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-modules.png)

</details>

<details>
<summary>Social preview</summary>

![Social preview](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-og.png)

</details>

<details>
<summary>Build</summary>

![Build](https://raw.githubusercontent.com/baseballyama/vite-devtools-svelte/main/docs/images/ui-build.png)

</details>

## Requirements

- **Vite** >= 8.3.2
- **Svelte** 5 (runes mode)
- **SvelteKit** (recommended, but not required for basic features)
- **[@vitejs/devtools](https://devtools.vite.dev/)** >= 0.7.6 — optional; only for the in-page dock

## Installation

```bash
npm install -D vite-devtools-svelte
# optional: show the panels inside the Vite DevTools dock
npm install -D @vitejs/devtools
```

## Setup

Register the plugin in your `vite.config.ts`. `svelteDevtools()` **must come before `sveltekit()`** so that its transforms run before the Svelte compiler.

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteDevtools } from 'vite-devtools-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    svelteDevtools(), // must come before sveltekit()
    sveltekit(),
  ],
})
```

Start your dev server as usual (`npm run dev`) and open the URL it prints:

```
  ➜  Svelte DevTools: http://localhost:5173/.svelte-devtools/
```

The first time a browser opens the DevTools it asks for a one-time code: request it from the page, and the dev server prints a 6-digit code plus a link (`…/.svelte-devtools/#devframe_otp=…`) in the terminal. Opening the link (or typing the code) trusts that browser; the token is remembered across reloads and dev-server restarts.

### Inside the Vite DevTools dock

With `@vitejs/devtools` installed, add its plugin as well. The Svelte tool then mounts as a dock entry instead of standalone (never both), and authentication is handled once by Vite DevTools:

```ts
import { DevTools } from '@vitejs/devtools'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})
```

Open your app, click the floating Vite DevTools handle and switch to the **Svelte** tab. The panels are also reachable directly at `/.svelte-devtools/`.

## Options

```ts
svelteDevtools({
  // Enable component lifecycle tracking (default: true)
  componentTracking: true,
})
```

## How It Works

1. **Runtime wrapper** — Intercepts `svelte/internal/client` to track component lifecycle and reactive signals (`$state`, `$derived`, `$effect`). It only polls state / samples FPS while a DevTools tab or an MCP agent is watching.
2. **HMR channel** — Streams runtime data (component tree, render profiles, state-timeline deltas, reactive graph) from the browser to the dev server.
3. **Static analyzers** — Extract routes, component relations, assets, and project metadata from the filesystem.
4. **Devframe tool** — One portable [Devframe](https://devfra.me/) definition exposes all of this over a typed, schema-validated RPC. It is served standalone (`initDevframe` on Vite's own HTTP server) or mounted into Vite DevTools (`createPluginFromDevframe`); the UI connects with `connectDevframe()` either way.

The plugin is **development-only** — every sub-plugin is `apply: 'serve'`, so nothing of it reaches a production build. In development, the runtime only samples while a DevTools tab or MCP agent is watching (an activity lease), and the dev server keeps its buffers bounded.

## Upgrading from 0.3.x

The public API is unchanged — still `svelteDevtools({ componentTracking })`, and the same 15 panels. MCP keeps every existing tool and adds four reactivity tools (see [AI access](#ai-access-mcp)). What changed is how the UI is hosted and how it talks to the dev server:

|           | 0.3.x                                                                                   | 0.4.0                                                                                                                |
| --------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Host      | panels only rendered inside `@vitejs/devtools` (required)                               | standalone at `/.svelte-devtools/`, or inside the Vite DevTools dock when `@vitejs/devtools` is installed (optional) |
| Transport | DevTools Kit RPC + HTTP fallback (`/__svelte-devtools/rpc`, `/__svelte-devtools/asset`) | one Devframe WebSocket RPC (SSE in Vite middleware mode); the HTTP endpoints are removed                             |
| Auth      | per-process token injected into the UI HTML                                             | Devframe one-time code → per-browser token (secure by default); Vite DevTools' own auth when docked                  |
| Peer deps | `vite >= 8.0.0`                                                                         | `vite ^8.3.2` (uses the public `closeServer` hook), `@vitejs/devtools >= 0.7.6` optional                             |

Static assets in the Assets panel are now served by Vite itself (their public URL) instead of a custom endpoint. The MCP endpoint (`/__svelte-devtools/mcp`) is unchanged.

## Known limitations

- **Very large apps (tens of thousands of live components):** after the initial snapshot the runtime sends only component deltas (≤ 2 000 per message), with periodic full checkpoints. The panels, however, still fetch the whole stored tree (up to 50 000 instances) from the dev server whenever it changes — estimated at a few MB per refresh at that size, about once per second at most. Real-browser performance at this scale has not been benchmarked yet.
- **Deep in-place mutations of very large `$state` values** are detected after about 1 s (reassignments and primitive changes are picked up on the next 200 ms tick).
- **Several app tabs:** the panels show the tab that pushed most recently (up to 4 page loads are tracked); there is no per-tab selector yet.
- **Components tree selection** follows the same instance while the page stays loaded; after a reload, or when an instance is replaced (e.g. `{#key}`, HMR), it is matched by its position in the tree instead. Instances beyond the 50 000 cap are counted but cannot be selected.
- **Components added after the first render** (e.g. new `{#each}` rows) are placed under their parent using Svelte internals (checked in a browser on Svelte 5.56.8; the CI compatibility profiles run Svelte 5.57.1); with a different internal layout they would appear as separate top-level entries instead.
- **Reactivity:** which write changed a state is not recorded (the panel says "Cause: Not recorded"); full value inspection and per-signal history are not available (values are shown as bounded summaries; sampled changes are in the State timeline). Only state created during component init is tracked — module-level `.svelte.ts` state is not. A component's top-level `$effect` is deferred by Svelte until mount, so it appears as a node without dependencies (and may disappear after garbage collection): the graph shows what the runtime observed, not every dependency. Render profiles are still sent as a bounded full tail rather than deltas, and behaviour at very large scale (tens of thousands of components) has not been measured.
- **Restarts in Vite middleware mode** dispose the DevTools via Vite's `closeServer` hook, which is why `vite ^8.3.2` is required.

## AI access (MCP)

The plugin exposes an MCP (Model Context Protocol) endpoint so AI agents such as Claude Code can read performance metrics and run measurement sessions autonomously. The intent: surface the same data the panels show, in a shape an agent can act on — and let the agent's own file-editing tools propose fixes.

On dev-server startup the plugin prints a copy-pasteable registration command:

```
svelte-devtools MCP ready — register with Claude Code:
  claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<token>
```

The endpoint is gated by a per-process random token (MCP clients are local processes, not browser tabs, so they don't use the browser login). The token rotates every dev-server start, so you'll re-register after a restart.

The endpoint is served wherever your Vite dev server listens. With the default (`localhost`) only local processes can reach it; with `server.host` set to `true` or `0.0.0.0`, other machines on your network can reach it too and only the token protects it. There is no separate Host/Origin check.

### Tools exposed

| Tool                                               | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_performance_issues`                          | Cross-cuts render / reactive / load / fps and returns ranked issues with `suggestedTool` for drill-down. Entry point.                                                                                                                                                                                                                                   |
| `get_component_hotspots`                           | Top components by total render time.                                                                                                                                                                                                                                                                                                                    |
| `get_reactive_graph_problems`                      | Classified reactive-graph issues (over-connected effects, orphan deriveds, isolated nodes).                                                                                                                                                                                                                                                             |
| `get_load_waterfall`                               | SvelteKit `load` timings grouped by route.                                                                                                                                                                                                                                                                                                              |
| `get_fps_drops`                                    | FPS samples below threshold.                                                                                                                                                                                                                                                                                                                            |
| `get_render_profile`                               | Render profile entries for a specific file.                                                                                                                                                                                                                                                                                                             |
| `get_project_info`, `get_routes`                   | Package and framework versions; the SvelteKit routes tree (static analysis).                                                                                                                                                                                                                                                                            |
| `get_live_components`, `get_component_relations`   | Mounted component instances (`includeMeta: true` adds the page-load epoch the ids belong to, totals and a limit); static import relations between components.                                                                                                                                                                                           |
| `get_reactive_summary`                             | Busiest component instances from runtime counters (sampled changes and renders in a time window), with totals; does not capture the whole graph. Repeated identical requests may get the same answer for up to 1 s; `window.until` says when it was computed. `stale: true` means the app did not answer and an earlier (or empty) answer was returned. |
| `get_reactive_scope`                               | `$state` / `$derived` / `$effect` nodes of one component instance and their direct neighbours. Edges mean "can affect", not a recorded cause. Repeated identical requests may get the same answer for up to 1 s; `computedAt` says when the app built it.                                                                                               |
| `get_state_timeline`                               | Sampled `$state` changes after a cursor, at most 500 per call, with large values replaced by a size summary.                                                                                                                                                                                                                                            |
| `get_capture_info`                                 | What is held versus what the app reported, per dataset (totals, truncation, dropped counts).                                                                                                                                                                                                                                                            |
| `start_session`, `end_session`, `compare_sessions` | Bracket a measurement window so the agent can diff before/after a fix. `persist:true` writes the session to `node_modules/.vite-devtools-svelte/sessions/`.                                                                                                                                                                                             |
| `list_sessions`, `load_session`, `delete_session`  | Session inspection / cleanup. The agent owns disposal — the plugin never auto-persists.                                                                                                                                                                                                                                                                 |

### Skills

Two Claude Code skills ship under `node_modules/vite-devtools-svelte/skills/`:

- `vite-devtools-svelte:perf-audit` — captures a baseline session, calls `list_performance_issues`, and presents the top issues for the user to triage.
- `vite-devtools-svelte:perf-fix` — one issue per run: baseline → edit → after → `compare_sessions`, with `verdict` reported verbatim and an explicit revert path if the change regresses or has no effect.

Skill names are namespaced with `vite-devtools-svelte:` so they don't collide with other skills in your `.claude/skills/`.

To install for a given project:

```bash
mkdir -p .claude/skills
cp -r node_modules/vite-devtools-svelte/skills/* .claude/skills/
```

### Scope

**What an agent can see:** `get_state_timeline` and `get_reactive_scope` return values of `$state` in your running app (each timeline value capped, large ones summarised). Treat the token like any credential that grants read access to your app's state in development.

The MCP server is **read + measure only** — it never edits files. Editing is left to the agent's own tools (Claude Code's `Edit`/`Write`), which keeps the permission boundary clean and lets `git` own rollback.

## Security model

Some RPCs read files from disk or open them in your editor, so the DevTools backend is authenticated even though the dev server is normally only reachable from `localhost`.

- **Devframe auth gate.** Every RPC connection must be trusted first: a browser exchanges a single-use 6-digit code (printed in the dev-server terminal, valid for 5 minutes) for a bearer token stored in that browser. Inside Vite DevTools the hub's own gate covers the tool.
- **Origin checks.** The RPC WebSocket only accepts loopback origins (plus the dev server's own LAN origins when you use `--host`), which blocks cross-site pages and DNS-rebinding attacks.
- **Schema-validated arguments.** RPC inputs are validated with zod schemas before any handler runs.
- **Path sandbox.** `inspect-file`, `open-in-editor`, and `open-reactive-in-editor` resolve their input through `fs.realpath()` and refuse anything outside the project root. Symlinks inside the project are followed normally.
- **SSRF defenses.** Outbound fetches from the API playground and OG preview block private / loopback / link-local IPv4 and IPv6 targets (also when a hostname _resolves_ to one), `localhost`, `*.local` and `*.internal`, and never follow redirects. The dev server's own origins are the only local targets allowed, so the playground can call your app's endpoints.
- **Dev-only by construction.** Nothing is registered during `vite build`.

Trusted-browser tokens are stored in your home directory (`~/.svelte-devtools/devframe/auth.json`) and shared across projects. The SSRF check resolves hostnames before fetching, so a resolver that changes its answer between that check and the request (DNS rebinding) is not fully excluded. If you bind your dev server to a non-loopback address, only use it on networks you trust.

## Contributing

Contributions are welcome! Please see the [repository](https://github.com/baseballyama/vite-devtools-svelte) for development setup and to open issues or pull requests.

## License

[MIT](https://github.com/baseballyama/vite-devtools-svelte/blob/main/LICENSE) © Yuichiro Yamashita

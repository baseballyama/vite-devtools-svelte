# vite-devtools-svelte

## 0.6.1

### Patch Changes

- [#119](https://github.com/baseballyama/vite-devtools-svelte/pull/119) [`054e835`](https://github.com/baseballyama/vite-devtools-svelte/commit/054e835b9d284cd3c8973ee0bc90ba55ddd8401d) Thanks [@baseballyama](https://github.com/baseballyama)! - Static analysis reads code with a parser instead of regular expressions. Jump-to-declaration no longer lands on a `let` in a comment or string, finds destructured bindings, later declarators and `$state` class fields (`Counter.count`), and opens the N-th `$effect` for `effect_N`. The component graph ignores commented-out, string and markup look-alike imports and type-only imports, and now includes re-exports, side-effect imports and literal `import()`s. The OG preview ignores `<meta>` / `<title>` inside comments, scripts and SVG, takes the charset only from a `charset` / `http-equiv` meta tag, and no longer turns `&constructor;` into source text.

- [#115](https://github.com/baseballyama/vite-devtools-svelte/pull/115) [`f7b430a`](https://github.com/baseballyama/vite-devtools-svelte/commit/f7b430a64508a9977a2a8a018e0b60d1577c704f) Thanks [@baseballyama](https://github.com/baseballyama)! - Code panes highlight a `<style>` rule whose selector has a pseudo-class (`button:focus-visible {`) as a selector instead of as a `property: value` declaration.

- [#123](https://github.com/baseballyama/vite-devtools-svelte/pull/123) [`6af48f1`](https://github.com/baseballyama/vite-devtools-svelte/commit/6af48f1156e9799d21a465c3180376316c41ec97) Thanks [@baseballyama](https://github.com/baseballyama)! - Reactivity graph: a fitted graph is centred in the view (it sat 80 units off to the side), a changed markup node pulses purple instead of with the `$effect` red glow, and object or array values on nodes read as JSON instead of `[object Object]`. Overview: the Modules tile no longer says "no cycles" when the module graph could not be read.

- [#121](https://github.com/baseballyama/vite-devtools-svelte/pull/121) [`8d1aa11`](https://github.com/baseballyama/vite-devtools-svelte/commit/8d1aa118566ad45b6ba53da12c4200038de60f76) Thanks [@baseballyama](https://github.com/baseballyama)! - A component snapshot entry that is not an object with a numeric `id` (e.g. `null` from an out-of-spec runtime) is ignored instead of being listed as a live component.

- [#126](https://github.com/baseballyama/vite-devtools-svelte/pull/126) [`abf4789`](https://github.com/baseballyama/vite-devtools-svelte/commit/abf47899ea2d6660f3748249f1153968d3b06a98) Thanks [@baseballyama](https://github.com/baseballyama)! - Panels no longer mistake a failed load for "nothing recorded": Problems, Render, Load functions, Frame rate, Build, API and Compiled output now show the error. The selected problem or load call stays selected when new entries arrive or old ones are dropped, a kind filter (Modules, Assets) stays visible after its last item goes away, two app tabs reporting a frame drop in the same millisecond no longer break the Frame rate chart, and a Reactivity graph filtered to nothing says no signal matches.

- [#122](https://github.com/baseballyama/vite-devtools-svelte/pull/122) [`ed7e6f7`](https://github.com/baseballyama/vite-devtools-svelte/commit/ed7e6f7dcbc29b0ee43dfa67996631186f2b0116) Thanks [@baseballyama](https://github.com/baseballyama)! - Component names drop only the trailing `.svelte` (`Item.sveltekit.svelte` is no longer shown as `Itemkit.svelte`), and an unhandled rejection whose reason cannot be converted to a string no longer makes the devtools listener throw.

- [#117](https://github.com/baseballyama/vite-devtools-svelte/pull/117) [`00477e3`](https://github.com/baseballyama/vite-devtools-svelte/commit/00477e35becda66d4aa2b2c843897e3701e13794) Thanks [@baseballyama](https://github.com/baseballyama)! - Component tracking no longer corrupts markup when a line of a component's text starts with `$.push($$props` (e.g. inside `<pre>`), and the reactive graph now attributes reads of object keys containing a quote or backslash (`obj["it's"]`) to the right `$state`.

- [#116](https://github.com/baseballyama/vite-devtools-svelte/pull/116) [`3ec87f1`](https://github.com/baseballyama/vite-devtools-svelte/commit/3ec87f196e0e566dfa4bdd6a20840ffe2801fac8) Thanks [@baseballyama](https://github.com/baseballyama)! - Compiler warnings are now captured: they are taken from vite-plugin-svelte's `onwarn` as structured warnings (code, file, line, column) instead of being parsed out of Vite's logger, which vite-plugin-svelte's dev warnings never reach. A component compiled for both client and SSR lists each warning once.

  SvelteKit load profiling finds the exported `load` with a parser instead of text matching: an `export const load` mentioned in a comment or string no longer breaks the module, names declared together with `load` (`export const ssr = false, load = …`) stay exported, and the route is taken from `<root>/src/routes` (a project path containing `routes` no longer garbles it).

## 0.6.0

### Minor Changes

- [#112](https://github.com/baseballyama/vite-devtools-svelte/pull/112) [`9723083`](https://github.com/baseballyama/vite-devtools-svelte/commit/9723083e32bee866a8bbf7d957c4f7bb86cfdf38) Thanks [@baseballyama](https://github.com/baseballyama)! - - New `clientAuth` option: `svelteDevtools({ clientAuth: false })` turns off the one-time code for the standalone DevTools on a trusted single-user machine (default `true`). In the Vite DevTools dock, use `DevTools({ clientAuth: false })` from `@vitejs/devtools`.
  - The shipped skills are renamed `vite-devtools-svelte-perf-audit` and `vite-devtools-svelte-perf-fix` (they were `vite-devtools-svelte:perf-audit` / `:perf-fix`). The new names follow the Agent Skills spec, so agents such as pi that reject `:` can load them. Re-copy the skills into `.claude/skills/` and call them by the new names.

### Patch Changes

- [#113](https://github.com/baseballyama/vite-devtools-svelte/pull/113) [`ceeaf68`](https://github.com/baseballyama/vite-devtools-svelte/commit/ceeaf68b99baba3dd96ac5d82057583f05457156) Thanks [@baseballyama](https://github.com/baseballyama)! - Overview: "Mounted components" no longer stays at 0 when the DevTools open before the app has reported its components. The count now updates while the overview is open, and is fetched again only when the components changed.

- [#108](https://github.com/baseballyama/vite-devtools-svelte/pull/108) [`9dfc598`](https://github.com/baseballyama/vite-devtools-svelte/commit/9dfc598adc1a4b1c92c0fd625e777c9844e0d020) Thanks [@baseballyama](https://github.com/baseballyama)! - Security: the API playground and Social preview no longer fetch private addresses written as bracketed IPv6 literals (`http://[fd00::1]/`, `http://[fe80::1]/`, `http://[::ffff:127.0.0.1]/`) or in ranges the old check missed (`0.0.0.0/8`, `100.64.0.0/10`, multicast, reserved, documentation and benchmarking ranges, NAT64 and 6to4 forms of private IPv4, `*.localhost`, `localhost.`). Names that fail to resolve are now rejected instead of fetched.

- [#109](https://github.com/baseballyama/vite-devtools-svelte/pull/109) [`0326952`](https://github.com/baseballyama/vite-devtools-svelte/commit/03269522219ff3ee89f21dce19fb67cb975620c6) Thanks [@baseballyama](https://github.com/baseballyama)! - Internal hardening from stricter type checking and linting: malformed hot-channel payloads (non-object messages, FPS samples without numbers, runtime errors without a string message) are dropped instead of stored; a failing MCP request is logged instead of becoming an unhandled rejection; a custom `logger.warn` is called with its logger as `this`; `exports` lists `types` first and exports `./package.json`.

- [#110](https://github.com/baseballyama/vite-devtools-svelte/pull/110) [`23cf5be`](https://github.com/baseballyama/vite-devtools-svelte/commit/23cf5be62891be234b7570e4457d675edff6306c) Thanks [@baseballyama](https://github.com/baseballyama)! - Fixes found by the new test suite:

  - Routes: layout resets (`+page@.svelte`, `+page@(group).svelte`, `+layout@….svelte`) are listed instead of disappearing; parameter matchers (`[id=integer]`), partial segments (`foo-[id]`, `[a]-[b]`) and escapes (`[x+2e]`) are parsed correctly.
  - API endpoints: methods are read from the module's exports (`export { handler as GET }`, `HEAD`, `OPTIONS`, `fallback`) instead of substrings, so `export const GETTER` or comments no longer count; requests and Social preview fetches time out after 30 s.
  - Social preview: quoted values with apostrophes, `data-*` attributes, entities, declared charsets, relative `og:image` and first-tag-wins are handled.
  - Build analysis no longer counts `build/client` twice; dangling symlinks no longer break asset/build scans; a `package.json` mid-edit no longer breaks every panel.
  - Module graph marks every module in a cycle; MCP `end_session` with `keep: 'discard'` works; p95 uses nearest rank; omitted `effectMaxDeps` keeps the default.
  - MCP endpoint: constant-time token check, and a 500 instead of a hanging request when the server cannot be built.
  - Component tracking: components whose markup contains `$.push(` and file ids with `$&`-style sequences are tracked; load profiling no longer breaks `load` for non-serializable results; coloured compiler warnings keep their location; the dock tag is not injected into a `</body>` inside a comment or script.
  - Reactivity graph build is no longer quadratic in the number of proxy sources.
  - UI: Svelte highlighting with `>` inside tag expressions and multi-line comments/template literals, highlight offsets for characters like `İ`, component boxes for same-named files in different folders, byte sizes above MB, NaN/Infinity values, polled panels after a missing dataset counter, and stale responses after Clear.

- [#106](https://github.com/baseballyama/vite-devtools-svelte/pull/106) [`1997f14`](https://github.com/baseballyama/vite-devtools-svelte/commit/1997f14e48d350bfcf011d40b764c0efdc71df15) Thanks [@baseballyama](https://github.com/baseballyama)! - Internal: the browser runtime is now plain JavaScript sources (linted and formatted) inlined at build time, and `vite-devtools-svelte/package.json` is exported. No behavior change.

- [#111](https://github.com/baseballyama/vite-devtools-svelte/pull/111) [`7ea6444`](https://github.com/baseballyama/vite-devtools-svelte/commit/7ea64445c90f44e6f221f60a3227ee74b974d22d) Thanks [@baseballyama](https://github.com/baseballyama)! - DevTools UI: the State timeline shows an error instead of "No state changes yet" when loading fails; accessible names for the search fields, command palette, graph zoom buttons and graph nodes (which also report their selected state and respond to Space); valid ARIA for table headers and labelled groups.

## 0.5.0

### Minor Changes

- [#104](https://github.com/baseballyama/vite-devtools-svelte/pull/104) [`ef8da61`](https://github.com/baseballyama/vite-devtools-svelte/commit/ef8da613903741d06a54293de78f902ca51e54ba) Thanks [@baseballyama](https://github.com/baseballyama)! - Reactivity tracking reworked and verified against real Svelte components:

  - `$effect` / `$effect.pre` nodes now have their dependencies (they were always shown without edges, because Svelte defers a component's top-level effect until mount).
  - Reads from the markup (`{expr}`, attributes, `{#if}`/`{#each}` conditions, `<svelte:head>`) are edges to a new per-component **markup** node (`type: 'template'`), so a `$derived` used only in the template is no longer reported as unused.
  - Object/array `$state` (proxies, class fields, reassigned objects) now has edges: reads of their properties are attributed to the state node, also across components through props.
  - Shared state of `.svelte.js` / `.svelte.ts` modules is tracked (graph, timeline, overview rows with `kind: 'module'`).
  - `orphanDeriveds` (MCP `get_reactive_graph_problems`) now means "never evaluated"; a derived read only by an event handler is not listed, and `derived-orphan` is no longer a performance issue. Nodes depending on state devtools does not track (e.g. SvelteKit's `$app/state`) report `untrackedDeps` and are not listed as isolated.
  - `{@const}` in `{#each}` items and several instances of a `$state` class no longer overwrite each other's node; nodes of removed items / re-run effects leave the graph and counts.
  - A component whose init throws inside `<svelte:boundary>` no longer leaves a ghost instance or misattributes later components.
  - The runtime script injected into `index.html` (plain Svelte + Vite) no longer fails to load with a CORS error.

### Patch Changes

- [#103](https://github.com/baseballyama/vite-devtools-svelte/pull/103) [`180669f`](https://github.com/baseballyama/vite-devtools-svelte/commit/180669f85fc4b599bf26eede83a7eea97a7f41f5) Thanks [@baseballyama](https://github.com/baseballyama)! - Frame rate panel no longer lowers the frame rate it measures. In the Vite DevTools dock the panel shares the app's main thread, and the "Live" indicator's never-ending box-shadow pulse forced a style recalculation and repaint every frame (about 8 fps instead of 60 on slower machines). The indicator is now static, and the loading animations run on the compositor (transform / opacity only).

## 0.4.1

### Patch Changes

- [#100](https://github.com/baseballyama/vite-devtools-svelte/pull/100) [`19cf387`](https://github.com/baseballyama/vite-devtools-svelte/commit/19cf387ebcbc30a6e251957c5647131936255328) Thanks [@baseballyama](https://github.com/baseballyama)! - Trim the state timeline ring in bulk instead of once per recorded change. With the DevTools open, an input that writes thousands of `$state` values no longer runs one `splice` per change; the ring is applied before every read (each push, the full snapshot, `getStateTimeline()` and `clearStateTimeline()`) and when more than 1000 entries or 4 MB are held. Reads still return the newest 500 entries within 4 MB, and unsent entries removed by the ring are still reported as dropped, including when the timeline is cleared.

## 0.4.0

### Minor Changes

- [#79](https://github.com/baseballyama/vite-devtools-svelte/pull/79) [`dc60aa2`](https://github.com/baseballyama/vite-devtools-svelte/commit/dc60aa216c9dbbe3d351a264936ed3740756a252) Thanks [@baseballyama](https://github.com/baseballyama)! - Rebuild the DevTools on [Devframe](https://devfra.me/): the same 15 panels now run **standalone** at `/.svelte-devtools/` on your dev server, or inside the Vite DevTools dock when `@vitejs/devtools` is installed (it is now optional). `svelteDevtools({ componentTracking })` and the MCP endpoint (`/__svelte-devtools/mcp`) keep working as before.

  **Breaking (0.x minor):**

  - Peer dependency `vite` raised to `^8.3.2` (uses the public `closeServer` hook).
  - The HTTP fallback endpoints `/__svelte-devtools/rpc` and `/__svelte-devtools/asset` are removed; the UI talks to the dev server over one Devframe WebSocket RPC (SSE in Vite middleware mode). The Assets panel uses Vite-served public URLs.
  - Standalone use is authenticated by default: the first visit from a browser asks for a one-time code printed in the dev-server terminal (or the printed magic link). Trusted-browser tokens are stored in your home directory (`~/.svelte-devtools/devframe/auth.json`) and shared across projects. Inside the Vite DevTools dock, its own authentication applies.

  **Reactivity for large apps:** the Reactivity panel opens on a cheap whole-app overview (the busiest components from sampled runtime counters, with what the counts cover) and loads the graph of one component on demand, within node/edge caps. Edges show current dependencies ("can affect"), not a recorded cause. The state timeline never reports the first observation of a signal as a change and says while that baseline is incomplete. Not included yet: which write changed a state, full value inspection, per-signal history, module-level state, dependencies of a component's top-level `$effect`, and render-profile deltas.

  **MCP:** all existing tools keep their default output; `get_live_components` accepts `includeMeta` (page-load epoch, totals, limit). Four new tools: `get_reactive_summary`, `get_reactive_scope`, `get_state_timeline` and `get_capture_info`.

  **Compatibility:** checked in CI with plain Svelte + Vite, SvelteKit 2 and SvelteKit 3, each standalone and inside the Vite DevTools dock. SvelteKit 3's `#lib` imports and its new dev server template are supported (the dock is now injected on SvelteKit 3).

  Also: the injected runtime only samples state / FPS while a DevTools tab or MCP agent is watching, sends state-timeline and component changes as deltas, and RPC arguments are schema-validated.

## 0.3.0

### Minor Changes

- [#64](https://github.com/baseballyama/vite-devtools-svelte/pull/64) [`1e57970`](https://github.com/baseballyama/vite-devtools-svelte/commit/1e5797021f908e26af7b20e204ae2d77bd22a9d2) Thanks [@aster-mnch](https://github.com/aster-mnch)! - Record per-component render counts and render times in the Render tab. The profiling APIs (`recordRender` / `recordRenderTime`) existed but had no call sites, so renders always showed 0. The `svelte/internal/client` wrapper now instruments `template_effect` / `deferred_template_effect` (skipping the initial mount-time run, pooling durations per microtask flush) and wraps block helpers (`each` / `if` / `key` / `await` / `component` / `boundary`) so effects created during batch flushes — e.g. `{#each}` items added later or re-created `{#if}` branches — are attributed to their owning component. Profiles and reactive-node snapshots are now also cleaned up on unmount, so the Render tab no longer accumulates stale rows after client-side navigation.

### Patch Changes

- [`53990d9`](https://github.com/baseballyama/vite-devtools-svelte/commit/53990d9c717905b1a1a0800f203740a695185d53) Thanks [@aster-mnch](https://github.com/aster-mnch)! - Fix the Inspect panel leaking its gutter-height polling interval: `onMount` was async, so the returned cleanup was wrapped in a Promise and never ran on unmount. The mount callback is now synchronous and the interval is cleared when the panel is closed.

## 0.2.1

### Patch Changes

- [#59](https://github.com/baseballyama/vite-devtools-svelte/pull/59) [`01d3de7`](https://github.com/baseballyama/vite-devtools-svelte/commit/01d3de7cc44e8ef0d58904d6348980c63ba801f3) Thanks [@baseballyama](https://github.com/baseballyama)! - - Bump `@modelcontextprotocol/sdk` runtime dependency from `^1.18.0` to `^1.29.0`.
  - Update package README to clarify that `@vitejs/devtools` is a required peer and must be registered alongside `svelteDevtools()` — without it the dev server starts but the DevTools UI does not appear.

## 0.2.0

### Minor Changes

- [#50](https://github.com/baseballyama/vite-devtools-svelte/pull/50) [`81edcfd`](https://github.com/baseballyama/vite-devtools-svelte/commit/81edcfdedd72b3444fc90b0584e70bb0b1d27718) Thanks [@baseballyama](https://github.com/baseballyama)! - Add MCP (Model Context Protocol) endpoint at `/__svelte-devtools/mcp` so AI agents such as Claude Code can read performance metrics and run measurement sessions autonomously.

  The MCP server is **read + measure only** — it never edits files. Editing is left to the agent's own tools, which keeps the permission boundary clean and lets `git` own rollback.

  **Tools exposed**
  - `list_performance_issues` — cross-cuts render / reactive / load / fps and returns ranked issues with `suggestedTool` for drill-down.
  - `get_component_hotspots`, `get_reactive_graph_problems`, `get_load_waterfall`, `get_fps_drops`, `get_render_profile` — detail views.
  - `get_project_info`, `get_routes`, `get_live_components`, `get_component_relations` — context.
  - `start_session`, `end_session`, `compare_sessions`, `list_sessions`, `load_session`, `delete_session` — bracket a measurement window so the agent can diff before/after a fix. `persist:true` (or `end_session` with `keep:"disk"`) writes to `node_modules/.vite-devtools-svelte/sessions/`; otherwise sessions stay in memory.

  The endpoint reuses the existing per-process random token used by the panel UI. On dev-server startup the plugin prints a copy-pasteable `claude mcp add` command including the URL and token.

  **Skills** shipped under `node_modules/vite-devtools-svelte/skills/`:
  - `vite-devtools-svelte:perf-audit` — captures a baseline session, calls `list_performance_issues`, and presents the top issues for the user to triage.
  - `vite-devtools-svelte:perf-fix` — one issue per run: baseline → edit → after → `compare_sessions`, with `verdict` reported verbatim and an explicit revert path if the change regresses or has no effect.

### Patch Changes

- [#42](https://github.com/baseballyama/vite-devtools-svelte/pull/42) [`55947f6`](https://github.com/baseballyama/vite-devtools-svelte/commit/55947f6cfaa398c35d4a9e138520f217627cd955) Thanks [@renovate](https://github.com/apps/renovate)! - Bump `@vitejs/devtools-kit` to `^0.2.0` and raise the `vite` peer-dependency range floor to `^8.0.14`.

## 0.1.2

### Patch Changes

- [#39](https://github.com/baseballyama/vite-devtools-svelte/pull/39) [`8e5c7fd`](https://github.com/baseballyama/vite-devtools-svelte/commit/8e5c7fdf1beb440ef687dba836e1d06f44825a09) Thanks [@baseballyama](https://github.com/baseballyama)! - Bump `@vitejs/devtools-kit` to `^0.1.23` to track upstream Vite DevTools, and fix the upstream link in the README to point at `vitejs/devtools`.

## 0.1.1

### Patch Changes

- [`9f9f146`](https://github.com/baseballyama/vite-devtools-svelte/commit/9f9f146674663f4e69e908e17c6f78033b3bf1f6) Thanks [@baseballyama](https://github.com/baseballyama)! - Include README and LICENSE in the published npm package so the package page renders documentation, screenshots, and the MIT license alongside the source.

## 0.1.0

### Minor Changes

- initial release

# Compatibility profiles

Smoke tests that run the plugin in three kinds of apps, each **standalone**
(the plugin serves `/.svelte-devtools/`) and **inside the Vite DevTools dock**
(`@vitejs/devtools`). The profiles and their exact versions are listed in
[`matrix.json`](./matrix.json).

| Profile        | App                                                                            | Framework                   | Where                     |
| -------------- | ------------------------------------------------------------------------------ | --------------------------- | ------------------------- |
| `plain-svelte` | `examples/plain-svelte`                                                        | Svelte + Vite, no SvelteKit | pnpm workspace            |
| `kit2`         | `examples/sample-app` (unchanged; standalone uses `vite.standalone.config.ts`) | SvelteKit 2                 | pnpm workspace            |
| `kit3`         | `compat/kit3`                                                                  | SvelteKit 3                 | **outside** the workspace |

`compat/kit3` stays outside the workspace on purpose. SvelteKit 3 needs
Svelte ≥ 5.57.1, and keeping it in its own install means the Kit 2 apps keep
the versions they were tested with. It also installs the plugin from a packed
tarball, the way users get it.

This is a compatibility check, not a benchmark. The 50k-instance performance
runs live under `perf/` and are opt-in.

## Run locally

```sh
pnpm install
pnpm build                                     # plugin + client UI
node scripts/compat/prepare.mjs kit3           # pack + install (out-of-workspace profiles only)
node scripts/compat/smoke.mjs kit3 --tier=2           # standalone
node scripts/compat/smoke.mjs kit3 --dock --tier=2    # inside the Vite DevTools dock
```

`prepare.mjs` fails if an installed version differs from `matrix.json`.
`--tier=1` skips the browser checks. Each mode runs with the Vite config named
in the profile's `configs` (passed as `--config`); a config that serves both
modes switches with `SVELTE_DEVTOOLS_DOCK=1`.

`smoke.mjs` does the following:

- uses an isolated `HOME` and a free local port, and binds to `127.0.0.1`;
- bounds every step with a timeout and stops only the processes it started;
- reads the one-time code and the MCP token from the dev server's output in
  memory, never writing them to logs or artifacts.

## What is checked

`smoke.mjs` is owned by svelte-perf; this section is the contract.

- **Without a browser:**
  - the dev server starts and `/.svelte-devtools/` responds;
  - MCP over real HTTP: `tools/list` (exact tool set), 403 without the token,
    and `tools/call` for `get_project_info` (versions must match `matrix.json`),
    `get_routes` (SvelteKit: at least one route; plain Svelte: no routes),
    and `get_capture_info`;
  - a production build contains no devtools code;
  - dock mode: the injected `/__devtools/embedded.js` is served (a
    prerequisite only; it does not prove the dock UI works).
- **With one headless Chromium:**
  - first view: the app page is open, MCP `get_live_components` > 0, and
    `get_reactive_summary` has rows and is not stale;
  - HMR: one source edit, then the counts are checked again;
  - reconnect: the dev server restarts, the runtime resyncs and the new page
    load (epoch) is reported;
  - SvelteKit only: the SSR page renders and the `+page.server` load is
    profiled.
  - dock mode (all profiles): the Vite DevTools dock is present on the app
    page; opening the Svelte DevTools entry shows its UI in the dock's iframe
    after the hub's own authentication (a fresh code for this run); the
    Components view lists the app's components; after the HMR edit and after
    the restart, the dock UI shows data again without a manual reload.
  - wrong mode: in standalone mode no dock script is injected, and in dock
    mode the plugin does not also serve its own standalone mount.
- **UI first view:** the checklist in [`ui-first-view.md`](./ui-first-view.md).

A failed or skipped check is reported as such. Nothing is reported as passing
without its check having run.

## Updating versions

1. Change the exact versions in the fixture's `package.json`.
2. Update the same versions in `matrix.json`.
3. Workspace profiles: run `pnpm install` at the repo root to update
   `pnpm-lock.yaml`. `compat/kit3`: run
   `pnpm install --ignore-workspace` in `compat/kit3` to update its own
   lockfile.
4. Run the profile locally (above), then let CI run all profiles.

Add a new profile only for a new framework line, such as the next SvelteKit
major. The matrix is deliberately not a cross product of every version.

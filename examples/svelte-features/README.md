# svelte-features: Svelte feature coverage (no SvelteKit)

Plain Svelte + Vite with the Svelte features that change the shape of the component tree and reactivity. Port 5204.

```bash
pnpm build                            # build the plugin + UI at the repository root
pnpm examples svelte-features         # start it alone (--dock for the Vite DevTools dock)
```

`examples-ui-lib` (`examples/ui-lib`) is installed with `dependenciesMeta.injected`, so like a published npm library it sits under `node_modules`. Run `pnpm install` again after editing ui-lib.

## Sections

| Section      | Contents                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (header)     | 3 mount roots: `App` in `#app`, `Widget` in `#widget`, and `Floating` (`document.body`), which a button `mount()`s and `unmount()`s. The custom element `<x-badge>`                                                                       |
| blocks       | `{#if}` mount/unmount, keyed `{#each}` (add, remove, reorder, `animate:flip`, `transition:`), remount with `{#key}`, `{#await}` (resolve / reject), recursive `Tree`                                                                      |
| elements     | `{#snippet}` / `{@render}`, `children`, snippets passed to children (with args), `<svelte:element>`, `<svelte:window>` / `<svelte:document>` / `<svelte:head>`, a dynamic component held in a variable (`App` switches sections)          |
| boundaries   | `<svelte:boundary>`: a child that throws while rendering, a `failed` snippet, `reset`                                                                                                                                                     |
| bindings     | `setContext` / `getContext` (nested), `$bindable` + `bind:`, `bind:this` (an element and a component's exported function), callback props                                                                                                 |
| shared-state | A module `$state` object in `.svelte.ts`, a class with `$state` / `$derived` fields (created inside and outside components), `$state.raw`, `$derived.by`, `$effect.pre`, `$effect.root` outside components, `$state.snapshot`, `$inspect` |
| directives   | Actions (`use:clickOutside`) and attachments (`{@attach}`, rerun when the argument changes)                                                                                                                                               |
| legacy       | Legacy-mode components without runes (`export let`, `$:`, `createEventDispatcher`, `<slot>` / named slots) used from a runes parent                                                                                                       |
| library      | App components passed as children / snippets to the library's `Card` / `LibButton` / `Tabs`                                                                                                                                               |
| problems     | Deliberate compiler warnings (3 a11y) and a runtime error thrown outside a boundary                                                                                                                                                       |
| stress       | About 1000 rows rendered and all rows updated at once (for the Render profiler)                                                                                                                                                           |

`svelte-check` also reports `options_missing_custom_element` on `Badge.ce.svelte`. `dynamicCompileOptions` in `vite.config.ts` adds `customElement: true`, which svelte-check cannot see, so this is not an app problem.

## Checklist

- **Components**
  - [ ] 3 roots: `App`, `Widget` and `Badge.ce` (custom element). "mount floating root" adds `Floating`, and pressing it again removes it
  - [ ] In the library section, `Card` / `LibButton` / `Tabs` are not in the tree, and `Ticker` / `Tree` inside them sit directly under `Library`
  - [ ] The recursive `Tree` in blocks nests. Remounting with `{#key}` and toggling `{#if}` swap nodes
  - [ ] The props and state of the selected `Slider` / `Consumer` follow interaction. The legacy `LegacyCounter` shows props and values too
- **Svelte Inspector** (Alt+X / Option+X, right-click an element → Inspect)
  - [ ] Elements of the second and third roots (Widget at the bottom right, Floating at the bottom left) select that instance
  - [ ] Inspecting inside the library `Card` selects the nearest app component. In the right-click menu, library rows only have "Open"
  - [ ] Elements of dynamic components (sections) and `<svelte:element>` can be selected
  - [ ] The label shows the instance name (e.g. `<Slider>`), not the element tag
  - [ ] Pressing Inspect on an outer component's row in the right-click menu selects that instance without opening the editor. Open opens the editor
- **Reactivity**
  - [ ] The overview shows `src/lib/state.svelte.ts` (module state), and its count grows with the shared-state actions
  - [ ] Selecting `SharedState` shows `count` / `doubled` / `parity` of the `Counter` class connected to `$effect.pre`
  - [ ] Starting `$effect.root` adds the effect outside components under `state.svelte.ts`
- **Render**
  - [ ] Rendering 1000 rows in stress and pressing "update every row" raises the render count and time of `Row`
  - [ ] `Ticker` in blocks (every second) and `Floating` (every second) keep rendering
- **State timeline**
  - [ ] Changes to `shared.clicks` in the header, `Counter.count`, the `$state.raw` replacement and the legacy `count` are recorded
- **Problems**
  - [ ] The 3 a11y warnings of `src/sections/Problems.svelte` show
  - [ ] How "throw a runtime error" in problems and "throw" in boundaries (caught by the boundary) are treated as runtime errors
- **Modules**
  - [ ] `src/main.ts` → `App.svelte` → each section, `src/lib/roots.ts` → `Floating.svelte`, and the `examples-ui-lib` dependency show

Check the same items in dock mode (`pnpm examples svelte-features --dock`).

# vite-devtools-svelte-inspector

A fork of the Svelte Inspector that ships inside
[`@sveltejs/vite-plugin-svelte`](https://github.com/sveltejs/vite-plugin-svelte/tree/main/packages/vite-plugin-svelte/src/plugins/inspector)
(copied from commit [`42e49eb`](https://github.com/sveltejs/vite-plugin-svelte/tree/42e49ebcc77ad220bb0d4c4840f7053a850fab1e/packages/vite-plugin-svelte/src/plugins/inspector), `@sveltejs/vite-plugin-svelte@7.3.1`).

It keeps the upstream behaviour, plus a link to vite-devtools-svelte: a click on an element (or
"inspect in DevTools" in its right-click menu) selects the component instance that rendered it in the
DevTools, and the DevTools can turn the inspector on.

This package is private. `@sveltejs/vite-devtools-svelte` bundles the built plugin into its
`dist/index.mjs` and copies `dist/runtime/Inspector.svelte` and `load-inspector.ts` to its own
`dist/runtime/`, where the bundled plugin looks for them. `svelteDevtools()` adds it (option
`inspector`), linked to the DevTools through `inspector-link.js`.

## Differences from upstream

This package is the master copy of the inspector: it does not track upstream, and the source under
`src/` follows this repository's formatting, lint and type-check rules. Behaviour matches upstream,
except for what a standalone plugin needs:

- options come from the plugin argument (`svelteInspector(options)`) instead of `vitePlugin.inspector` in `svelte.config.js`
- adding the plugin always enables it: `SVELTE_INSPECTOR_OPTIONS=true|false` does not toggle it (an options object and `SVELTE_INSPECTOR_TOGGLE` still apply)
- it turns off vite-plugin-svelte's built-in inspector, so the two never mount at the same time
- the plugin name and virtual module ids use the `vite-devtools-svelte-inspector` prefix, so they do not clash with the built-in inspector
- the source is TypeScript and built to `dist/` (`pnpm -C packages/inspector build`); the browser runtime in `src/runtime/` is copied as-is and compiled by the app's own Vite
- runtime files are read by Vite itself; upstream's own disk read for them never ran (its filter glob ended in `//**`) and is removed
- `src/utils/log.ts` is a reduced copy of upstream's logger
- `src/types.ts` holds only `InspectorOptions` (and `InspectorLink`, below)

### DevTools link

Every change for the DevTools is marked with a `vite-devtools-svelte:` comment. Without a link
(`svelteInspector(options)` alone) the runtime gets `null` from the new virtual module and behaves as
upstream.

| File                            | Change from upstream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/plugin.ts`                 | `svelteInspector(options, link)`: `link.devtools` is the absolute path of a module (the DevTools link). The new virtual id `virtual:vite-devtools-svelte-inspector-devtools` resolves to it, or to `export default null` without one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/types.ts`                  | `InspectorLink`, the second argument of `svelteInspector()` (exported from `src/index.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/runtime/ambient.d.ts`      | Declares the new virtual module and its `InspectorDevtools` interface (what the runtime calls on the link).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/runtime/load-inspector.ts` | Mounts the inspector inside `devtools.untracked()`, so the DevTools do not list it as one of the app's components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/runtime/Inspector.svelte`  | Imports the link. **Click** (and `openKey`) asks `devtools.pick(element)` to select the element's component instance in the DevTools, then turns the inspector off; with **Alt** held, or when the link does not know the element (`pick` returns false), it opens the editor as upstream. The hover label shows the component instance's name (`devtools.describe`) in place of the element's tag, and a hint row (`click: inspect · ⌥click: open in editor · right-click: more`, `Alt+` outside Apple platforms; `click: open in editor · right-click: more` for an unknown element) with its style. The context menu (right-click / `openMenuKey`) gets a first row, `<Name> inspect in DevTools`, that picks the element's component instance (opening the editor if `pick` returns false); it is shown only when `devtools.describe` knows the element. The rows for the element and its parent components open the editor as upstream: the parent entries of `__svelte_meta.parent` carry only a source location and a tag, not an instance, so they get no DevTools row. In `onMount` it calls `devtools.connect({ enable, disable })` so the DevTools' "Pick element" can turn it on and a pick in another tab turns it off; the cleanup unlinks it. |

## Setup

Through vite-devtools-svelte (the usual way): `svelteDevtools({ inspector: { ... } })`. Standalone:

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteInspector } from 'vite-devtools-svelte-inspector';

export default {
  plugins: [sveltekit(), svelteInspector({ toggleKeyCombo: 'alt-x', showToggleButton: 'always' })],
};
```

## Upstream documentation

The inspector is a Vite plugin that adds a Svelte inspector in the browser. It shows the file location where the element under cursor is defined and you can click to quickly open your code editor at this location, or right-click to show a context menu with additional options.

Note that `@sveltejs/vite-plugin-svelte` needs to be installed as a peer dependency as the inspector brings in Svelte components to be compiled.

### Environment variables

Svelte Inspector toggle keys and other options are personal preferences. As such it isn't always convenient to define them in a shared svelte config file.
To allow you to use your own setup, svelte inspector can be configured via environment variables, both from shell and dotenv files.

```shell
# just keycombo, unquoted string
SVELTE_INSPECTOR_TOGGLE=alt-x

# options object as json
SVELTE_INSPECTOR_OPTIONS='{"holdMode": false, "toggleButtonPos": "bottom-left"}'

```

> Inspector options set on the environment take precedence over options passed to `svelteInspector()`. Unlike upstream, `SVELTE_INSPECTOR_OPTIONS=true|false` is ignored: the inspector is on whenever the plugin is added.

### Plugin options

#### toggleKeyCombo

- **Type:** `string`
- **Default:** `'alt-x'`

  Define a key combo to toggle inspector.

  The value is recommended to be any number of modifiers (e.g. `control`, `shift`, `alt`, `meta`) followed by zero or one regular key, separated by `-`. Note that some keys have native behavior (e.g. `alt-s` opens history menu on firefox).

  Examples: `control-o`, `control-alt-s`, `meta-x`, `alt-i`.

#### navKeys

- **Type:** `{ parent: string; child: string; next: string; prev: string }`
- **Default:** `{ parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' }`

  Define keys to select elements with via keyboard. This improves accessibility and helps selecting elements that do not have a hoverable surface area due to tight wrapping.
  - `parent`: select closest parent
  - `child`: select first child (or grandchild)
  - `next`: next sibling (or parent if no next sibling exists)
  - `prev`: previous sibling (or parent if no prev sibling exists)

#### openKey

- **Type:** `string`
- **Default:** `'Enter'`

  Define key to open the editor for the currently selected dom node.

#### openMenuKey

- **Type:** `string`
- **Default:** `' '`

  Define key to open the context menu for the currently selected dom node.

#### escapeKeys

- **Type:** `string[]`
- **Default:** `['Backspace', 'Escape']`

  Define keys to close the inspector.

#### holdMode

- **Type:** `boolean`
- **Default:** `true`

  Inspector will only open when the `toggleKeyCombo` is held down, and close when released.

#### showToggleButton

- **Type:** `'always' | 'active' | 'never'`
- **Default:** `'active'`

  When to show the toggle button. The toggle button allows you to click on-screen to enable/disable the inspector, rather than using the `toggleKeyCombo`.
  - `'always'`: always show the toggle button
  - `'active'`: show the toggle button when the inspector is active
  - `'never'`: never show the toggle button

#### toggleButtonPos

- **Type:** `'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'`
- **Default:** `'top-right'`

  Where to display the toggle button.

#### customStyles

- **Type:** `boolean`
- **Default:** `true`

  Inject custom styles when inspector is active. This is useful if you want to customize the inspector styles to match your app.

  When the inspector is active, the `svelte-inspector-enabled` class is added to the `body` element, and the `svelte-inspector-active-target` class is added to the current active target (e.g. via hover or keyboard).

### Editors

If your editor is not [supported out of the box](https://github.com/yyx990803/launch-editor#supported-editors), you can follow [the instructions here](https://github.com/yyx990803/launch-editor#custom-editor-support) to add it.

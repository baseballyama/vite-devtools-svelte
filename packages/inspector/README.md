# vite-devtools-svelte-inspector

A fork of the Svelte Inspector that ships inside
[`@sveltejs/vite-plugin-svelte`](https://github.com/sveltejs/vite-plugin-svelte/tree/main/packages/vite-plugin-svelte/src/plugins/inspector)
(copied from commit [`42e49eb`](https://github.com/sveltejs/vite-plugin-svelte/tree/42e49ebcc77ad220bb0d4c4840f7053a850fab1e/packages/vite-plugin-svelte/src/plugins/inspector), `@sveltejs/vite-plugin-svelte@7.3.1`).

It keeps the upstream behaviour and is the starting point for linking the inspector to
vite-devtools-svelte (for example, jumping from a picked element to its node in the component graph).

## Differences from upstream

This package is the master copy of the inspector: it does not track upstream, and the source under
`src/` follows this repository's formatting, lint and type-check rules. Behaviour matches upstream,
except for what running in the Vite DevTools dock needs:

- options come from the plugin argument (`svelteInspector(options)`, which `svelteDevtools({ inspector })` passes on) instead of `vitePlugin.inspector` in `svelte.config.js`
- adding the plugin always enables it (`svelteDevtools({ inspector: false })` leaves it out): `SVELTE_INSPECTOR_OPTIONS=true|false` does not toggle it (an options object and `SVELTE_INSPECTOR_TOGGLE` still apply)
- it only runs in the [Vite DevTools dock](#in-the-vite-devtools-dock): without `@vitejs/devtools` in the Vite config it does nothing. This part is new, not copied from upstream
- there is no floating toggle button (`showToggleButton` and `toggleButtonPos` are gone): the dock has its own
- when vite-plugin-svelte's built-in inspector is configured (`vitePlugin.inspector`) and both would run in the dock, the dev server fails to start with an error that says to turn that one off. When only `SVELTE_INSPECTOR_OPTIONS` / `SVELTE_INSPECTOR_TOGGLE` switch it on, it is turned off instead
- the plugin name and virtual module ids use the `vite-devtools-svelte-inspector` prefix, so they do not clash with the built-in inspector
- the source is TypeScript and built to `dist/` (`pnpm -C packages/inspector build`); the browser runtime in `src/runtime/` is copied as-is and compiled by the app's own Vite
- runtime files are read by Vite itself; upstream's own disk read for them never ran (its filter glob ended in `//**`) and is removed
- `src/utils/log.ts` is a reduced copy of upstream's logger
- `src/types.ts` holds only `InspectorOptions`
- it dispatches a `svelte-inspector:pick` event and marks its components with `Symbol.for('svelte.devtools.ignore')` (see [below](#events)); this part is new, not copied from upstream

## Setup

This package is private and never published. It is not meant to be used on its own:
`svelteDevtools()` from `@sveltejs/vite-devtools-svelte` adds it to the plugins it returns,
and the plugin's build bundles it (plugin code into `dist/inspector/index.mjs`, the
browser runtime into `dist/inspector/runtime/`). Configure it through the `inspector`
option, or turn it off with `inspector: false`:

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';

export default {
  plugins: [
    svelteDevtools({ inspector: { toggleKeyCombo: 'alt-x', holdMode: false } }),
    sveltekit(),
  ],
};
```

## In the Vite DevTools dock

The inspector only runs in the [Vite DevTools](https://devtools.vite.dev) dock, so `@vitejs/devtools` has to be in the Vite config:

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { DevTools } from '@vitejs/devtools';

export default {
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
};
```

- **Svelte Inspector** on the dock bar turns the inspector on and off, as do the `toggleKeyCombo` and the **Toggle Svelte Inspector** command in the command palette; all of them stay in sync.
- Picked files open through Vite DevTools' `vite:core:open-in-editor`.
- The inspector loads once the browser is authorized for Vite DevTools.

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
SVELTE_INSPECTOR_OPTIONS='{"holdMode": false, "openKey": "o"}'

```

> Inspector options set on the environment take precedence over the `inspector` options passed to `svelteDevtools()`. Unlike upstream, `SVELTE_INSPECTOR_OPTIONS=true|false` is ignored: use `svelteDevtools({ inspector: false })` to turn the inspector off. These variables also switch vite-plugin-svelte's built-in inspector on; in the dock, this plugin turns that one off again.

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

#### customStyles

- **Type:** `boolean`
- **Default:** `true`

  Inject custom styles when inspector is active. This is useful if you want to customize the inspector styles to match your app.

  When the inspector is active, the `svelte-inspector-enabled` class is added to the `body` element, and the `svelte-inspector-active-target` class is added to the current active target (e.g. via hover or keyboard).

### Events

Every time an element is opened, the inspector dispatches a `svelte-inspector:pick` event on `window`, so other in-page tools (e.g. a devtools panel revealing the component) can react to it:

```js
window.addEventListener('svelte-inspector:pick', e => {
  // e.detail.loc: { file, line, column } of the element
  // e.detail.stack: the element and the components it is rendered in, innermost first
});
```

### Devtools UIs

The inspector's components are marked with `Symbol.for('svelte.devtools.ignore')`. Devtools that list the app's components and state leave a marked component, everything it renders and its state out of their panels. Other devtools UIs mounted into the page can use the same marker.

### Editors

If your editor is not [supported out of the box](https://github.com/yyx990803/launch-editor#supported-editors), you can follow [the instructions here](https://github.com/yyx990803/launch-editor#custom-editor-support) to add it.

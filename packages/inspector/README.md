# vite-devtools-svelte-inspector

A fork of the Svelte Inspector that ships inside
[`@sveltejs/vite-plugin-svelte`](https://github.com/sveltejs/vite-plugin-svelte/tree/main/packages/vite-plugin-svelte/src/plugins/inspector)
(copied from commit [`42e49eb`](https://github.com/sveltejs/vite-plugin-svelte/tree/42e49ebcc77ad220bb0d4c4840f7053a850fab1e/packages/vite-plugin-svelte/src/plugins/inspector), `@sveltejs/vite-plugin-svelte@7.3.1`).

It keeps the upstream behaviour and is the starting point for linking the inspector to
vite-devtools-svelte (for example, jumping from a picked element to its node in the component graph).

## Differences from upstream

The source under `src/` is a verbatim copy, except for what a standalone plugin needs:

- options come from the plugin argument (`svelteInspector(options)`) instead of `vitePlugin.inspector` in `svelte.config.js`
- adding the plugin always enables it: `SVELTE_INSPECTOR_OPTIONS=true|false` does not toggle it (an options object and `SVELTE_INSPECTOR_TOGGLE` still apply)
- it turns off vite-plugin-svelte's built-in inspector, so the two never mount at the same time
- the plugin name and virtual module ids use the `vite-devtools-svelte-inspector` prefix, so they do not clash with the built-in inspector
- `src/utils/log.js` is a reduced copy of upstream's logger
- `src/public.d.ts` holds only `InspectorOptions` and the plugin's signature
- with Vite DevTools in the Vite config, the inspector lives in its dock instead of the page (see [below](#in-the-vite-devtools-dock)); this part is new, not copied from upstream

## Setup

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteInspector } from 'vite-devtools-svelte-inspector'

export default {
  plugins: [sveltekit(), svelteInspector({ toggleKeyCombo: 'alt-x', showToggleButton: 'always' })],
}
```

## In the Vite DevTools dock

When [Vite DevTools](https://devtools.vite.dev) (`@vitejs/devtools`) is in the Vite config, the inspector is added to its dock instead of injecting itself into the page:

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { svelteInspector } from 'vite-devtools-svelte-inspector'

export default {
  plugins: [DevTools(), sveltekit(), svelteInspector()],
}
```

- **Svelte Inspector** on the dock bar turns the inspector on and off, as do the `toggleKeyCombo` and the **Toggle Svelte Inspector** command in the command palette; all of them stay in sync. The floating toggle button is not shown, so `showToggleButton` and `toggleButtonPos` don't apply.
- Picked files open through Vite DevTools' `vite:core:open-in-editor` instead of the `/__open-in-editor` middleware.
- **Svelte Inspector settings**, in the dock's **Svelte** group, edits your personal options: the shortcut, the keys used while picking (click one and press the key to record it), hold mode and styles. Saving writes the options that differ from the plugin options to `.env.local` as `SVELTE_INSPECTOR_OPTIONS`, and Vite restarts the dev server to apply them. **Reset to defaults** removes the variable again. If the shell or a `.env.[mode]` file also sets `SVELTE_INSPECTOR_OPTIONS`, the view says so, because that value wins over `.env.local`.
- The inspector loads once the browser is authorized for Vite DevTools.

The **Svelte** group (id `svelte`) is meant to be shared by Svelte tools: other plugins can add their dock entries to it with `groupId: 'svelte'`. Whichever plugin registers it first keeps its registration.

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

import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import { INSPECTOR_ICON_SVG } from './runtime/icon.js';
import type { InspectorOptions } from './types.js';
import { log } from './utils/log.js';

/** name of the inspector plugin that ships inside vite-plugin-svelte */
const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';

// vite-devtools-svelte: the inspector lives in the Vite DevTools dock
/** name of `@vitejs/devtools`' config plugin (the same check as svelteDevtools()) */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools';
const DOCK_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-dock';

/** The parts of the Vite DevTools node context (`DevToolsNodeContext`) the inspector uses */
interface DevtoolsContext {
  docks: { register(entry: Record<string, unknown>): void };
}

/** The inspector plugin, with the hook Vite DevTools (`@vitejs/devtools`) calls */
export type InspectorPlugin = Omit<Plugin, 'devtools'> & {
  devtools: { setup(ctx: DevtoolsContext): void };
};

/** `svg` as a data url */
const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function getInspectorPath(): string {
  // vite-devtools-svelte: the runtime sits next to this file instead of under
  // vite-plugin-svelte's `src/plugins/inspector/`.
  const pluginPath = normalizePath(import.meta.dirname);
  return `${pluginPath}/runtime/`;
}

/**
 * Svelte Inspector as a Vite plugin for the Vite DevTools (`@vitejs/devtools`) dock.
 *
 * It only runs in the dock: without Vite DevTools in the Vite config the plugin does nothing.
 * It does not turn off the built-in inspector of vite-plugin-svelte: when both would run,
 * the dev server fails to start with an error that says to turn that one off.
 *
 * vite-devtools-svelte: options come from the plugin argument instead of
 * vite-plugin-svelte's `inspector` option (see `configResolved`).
 */
export function svelteInspector(options: InspectorOptions = {}): InspectorPlugin {
  const inspectorPath = getInspectorPath();
  log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

  let inspectorOptions: InspectorOptions | undefined;
  /** Vite DevTools is installed, so the dock mounts the inspector */
  let dock = false;
  /** the inspector plugin of vite-plugin-svelte, always in the config but not always on */
  let builtin: Plugin | undefined;

  const base = () => inspectorOptions?.__internal?.base ?? '';

  return {
    name: 'vite-devtools-svelte-inspector',
    apply: 'serve',
    enforce: 'pre',

    applyToEnvironment(env) {
      if (env.config.consumer !== 'client') return false;
      // decided here, not in `configResolved`: the built-in inspector only knows whether
      // it is on once its own `configResolved` has run
      if (dock && builtin && (builtin.applyToEnvironment?.(env) ?? true) !== false) {
        throw new Error(
          "[vite-devtools-svelte] svelteDevtools() includes the Svelte Inspector, but vite-plugin-svelte's own inspector is enabled as well. " +
            'Turn that one off: remove `inspector` from `vitePlugin` in svelte.config.js (or from the options of `svelte()`). ' +
            'SVELTE_INSPECTOR_OPTIONS or SVELTE_INSPECTOR_TOGGLE in the shell or an env file switches it on too. ' +
            'To keep it instead, pass `inspector: false` to svelteDevtools().',
        );
      }
      return true;
    },

    configResolved(config) {
      dock = config.plugins.some(p => p.name === VITE_DEVTOOLS_PLUGIN);
      builtin = config.plugins.find(p => p.name === BUILTIN_INSPECTOR_NAME);

      // vite-devtools-svelte: this plugin is always on once it is added, so
      // `SVELTE_INSPECTOR_OPTIONS=true|false` does not toggle it; an options
      // object or `SVELTE_INSPECTOR_TOGGLE` still applies as a personal preference.
      const environmentOptions = parseEnvironmentOptions(config);

      inspectorOptions = {
        ...defaultInspectorOptions,
        ...options,
        ...(typeof environmentOptions === 'object' ? environmentOptions : {}),
        __internal: {
          base: config.base.endsWith('/') ? config.base.slice(0, -1) : config.base,
          root: config.root,
        },
      };
    },
    devtools: {
      setup(ctx: DevtoolsContext) {
        ctx.docks.register({
          id: 'svelte:inspector',
          title: 'Svelte Inspector',
          description: 'Pick an element to open its source in your editor',
          icon: dataUrl(INSPECTOR_ICON_SVG),
          type: 'action',
          toggle: true,
          action: {
            // so the key combo works before the first click; the hub loads it once it trusts
            // the browser, so the inspector needs Vite DevTools to be authorized first
            eager: true,
            // a url: the host would read `virtual:` as a url scheme
            importFrom: `${base()}/@id/__x00__${DOCK_MODULE_ID.slice(1)}`,
          },
        });
      },
    },
    resolveId: {
      filter: {
        id: /^\0?virtual:vite-devtools-svelte-inspector-/,
      },
      handler(id) {
        if (id === DOCK_MODULE_ID || id === DOCK_MODULE_ID.slice(1)) {
          return DOCK_MODULE_ID;
        }
        if (id === 'virtual:vite-devtools-svelte-inspector-options') {
          return id;
        }
        if (id.startsWith('virtual:vite-devtools-svelte-inspector-path:') && !id.includes('..')) {
          return id.replace('virtual:vite-devtools-svelte-inspector-path:', inspectorPath);
        }
        return null;
      },
    },
    // vite-devtools-svelte: only the virtual modules. Runtime files are read by Vite
    // itself: it lets through files reached by imports even outside `server.fs.allow`, and its
    // own read keeps them watched. (Upstream's disk-reading branch never ran: its glob was
    // `<runtime>//**`.)
    load: {
      filter: {
        id: {
          include: [
            /^virtual:vite-devtools-svelte-inspector-options$/,
            /^\0virtual:vite-devtools-svelte-inspector-dock$/,
          ],
        },
      },
      handler(id) {
        if (id === DOCK_MODULE_ID) {
          return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:devtools-action.ts";';
        }
        return `export default ${JSON.stringify(inspectorOptions ?? {})}`;
      },
    },
  };
}

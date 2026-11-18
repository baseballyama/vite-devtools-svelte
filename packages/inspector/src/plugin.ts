import process from 'node:process';

import { normalizePath } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';

import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import { INSPECTOR_DOCK_ICON } from './runtime/icon.js';
import { RESET_SETTINGS, SAVE_SETTINGS } from './runtime/settings-shared.js';
import type { ActionResult, Settings } from './runtime/settings-shared.js';
import { mergeOptions, pickOptions, updateSaved, validateSettings } from './settings.js';
import type { InspectorOptions } from './types.js';
import { log } from './utils/log.js';

const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';
/** name of vite-plugin-svelte's config plugin, whose `api.options` holds the resolved options */
const SVELTE_CONFIG_PLUGIN_NAME = 'vite-plugin-svelte:config';

/**
 * Whether the user turned on vite-plugin-svelte's inspector in its options. Unknown (`true`)
 * when vite-plugin-svelte no longer exposes them, so the startup error stays the default.
 */
function builtinConfigured(plugins: readonly Plugin[]): boolean {
  const api = plugins.find(p => p.name === SVELTE_CONFIG_PLUGIN_NAME)?.api as
    | { options?: { inspector?: unknown } }
    | undefined;
  return api?.options === undefined || Boolean(api.options.inspector);
}

/** name of `@vitejs/devtools`' config plugin (the same check as svelteDevtools()) */
const VITE_DEVTOOLS_PLUGIN = 'vite:devtools';
const DOCK_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-dock';
const SETTINGS_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-settings';
const OPTIONS_MODULE_ID = 'virtual:vite-devtools-svelte-inspector-options';
const SVELTE_DOCK_GROUP = 'svelte';
/** namespace of the saved settings in Vite DevTools, a file in its per-user settings directory */
const SETTINGS_NAMESPACE = 'svelte-inspector';
const SAVED_OPTIONS = 'options';

/** the parts of a Vite DevTools settings store (`DevframeSettingsStore`) the inspector uses */
interface SettingsStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The parts of the Vite DevTools node context (`DevToolsNodeContext`) the inspector uses */
interface DevtoolsContext {
  docks: { register(entry: Record<string, unknown>): void };
  rpc: {
    register(fn: {
      name: string;
      type: 'action';
      setup: () => { handler: (params?: unknown) => Promise<ActionResult> };
    }): void;
  };
  scope(namespace: string): { settings: { global: SettingsStore } };
  viteServer?: Pick<ViteDevServer, 'config' | 'environments'>;
}

/** The inspector plugin, with the hook Vite DevTools (`@vitejs/devtools`) calls */
export type InspectorPlugin = Omit<Plugin, 'devtools'> & {
  devtools: { setup(ctx: DevtoolsContext): void };
};

/** a settings action that reports a failure instead of throwing */
const action =
  (handler: (params: unknown) => Promise<ActionResult>) =>
  async (params?: unknown): Promise<ActionResult> => {
    try {
      return await handler(params ?? {});
    } catch (error) {
      return { ok: false, status: `Couldn't save: ${(error as Error).message}` };
    }
  };

/** The directory of the browser runtime the plugin serves, with a trailing `/` */
export function getInspectorPath(): string {
  const pluginPath = normalizePath(import.meta.dirname);
  return `${pluginPath}/runtime/`;
}

/**
 * Svelte Inspector as a Vite plugin for the Vite DevTools (`@vitejs/devtools`) dock.
 *
 * It only runs in the dock: without Vite DevTools in the Vite config the plugin does nothing.
 * When vite-plugin-svelte's built-in inspector is configured and both would run, the dev
 * server fails to start with an error that says to turn that one off. When only the
 * environment variables switched it on, it is turned off instead.
 */
export function svelteInspector(options: InspectorOptions = {}): InspectorPlugin {
  const inspectorPath = getInspectorPath();
  log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

  let internal: NonNullable<InspectorOptions['__internal']> | undefined;
  /** Vite DevTools is installed, so the dock mounts the inspector */
  let dock = false;
  /** the inspector plugin of vite-plugin-svelte, always in the config but not always on */
  let builtin: Plugin | undefined;
  /** options before the saved settings apply, what reset to defaults returns to */
  let baseOptions: Settings = mergeOptions(defaultInspectorOptions as Settings, options);
  /** where the settings view saves, once Vite DevTools has set the plugin up */
  let store: SettingsStore | undefined;
  let server: DevtoolsContext['viteServer'];

  const base = () => internal?.base ?? '';

  /** the saved settings the inspector can run with */
  const savedOptions = async () => {
    let stored: unknown;
    try {
      stored = await store?.get(SAVED_OPTIONS);
    } catch (error) {
      log.warn('could not read the saved settings', error, 'inspector');
    }
    const { options: saved, invalid } = pickOptions(stored);
    if (invalid.length > 0) {
      log.warn(`ignoring invalid saved settings: ${invalid.join(', ')}`, null, 'inspector');
    }
    return saved;
  };

  /** serve the options again, and reload the pages so the inspector picks them up */
  const apply = (done: string): ActionResult => {
    const client = server?.environments.client;
    const mod = client?.moduleGraph.getModuleById(OPTIONS_MODULE_ID);
    if (mod) client?.moduleGraph.invalidateModule(mod);
    if (!client || server?.config.server.hmr === false) {
      return { ok: true, status: `${done} Reload the page to apply.` };
    }
    client.hot.send({ type: 'full-reload' });
    return { ok: true, status: `${done} Reloading…` };
  };

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
            'Turn that one off: remove `inspector` from `vitePlugin` in svelte.config.js (or from the options of `svelte()`).',
        );
      }
      return true;
    },

    configResolved(config) {
      dock = config.plugins.some(p => p.name === VITE_DEVTOOLS_PLUGIN);
      builtin = config.plugins.find(p => p.name === BUILTIN_INSPECTOR_NAME);
      // `SVELTE_INSPECTOR_OPTIONS` / `SVELTE_INSPECTOR_TOGGLE` are personal preferences for this
      // inspector, but they switch the built-in one on too. When nothing else turned it on, keep
      // it out of every environment (Vite applies `applyToEnvironment` after `configResolved`)
      // instead of failing to start.
      if (dock && builtin && !builtinConfigured(config.plugins)) {
        builtin.applyToEnvironment = () => false;
        log.debug('disabled the built-in inspector of vite-plugin-svelte', null, 'inspector');
      }

      // `SVELTE_INSPECTOR_OPTIONS=true|false` cannot toggle this always-on plugin; an options
      // object or `SVELTE_INSPECTOR_TOGGLE` applies before the saved settings, so reset keeps it.
      const { options: fromEnvironment, invalid } = pickOptions(parseEnvironmentOptions(config));
      if (invalid.length > 0) {
        log.warn(
          `ignoring invalid options in environment SVELTE_INSPECTOR_OPTIONS: ${invalid.join(', ')}`,
          null,
          'inspector',
        );
      }
      baseOptions = mergeOptions(defaultInspectorOptions as Settings, options, fromEnvironment);
      internal = {
        base: config.base.endsWith('/') ? config.base.slice(0, -1) : config.base,
        cwd: process.cwd(),
        defaults: baseOptions,
      };
    },
    devtools: {
      setup(ctx: DevtoolsContext) {
        // registering fails when another svelte tool added the group first
        try {
          ctx.docks.register({
            id: SVELTE_DOCK_GROUP,
            title: 'Svelte tools',
            icon: 'logos:svelte-icon',
            type: 'group',
            category: 'framework',
            accentColor: '#ff3e00',
          });
        } catch (error) {
          log.debug('svelte dock group already registered', error, 'inspector');
        }

        ctx.docks.register({
          id: 'svelte:inspector',
          title: 'Pick element',
          description: 'Pick an element to open its source in your editor',
          icon: INSPECTOR_DOCK_ICON,
          groupId: SVELTE_DOCK_GROUP,
          category: 'default',
          defaultOrder: 60,
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

        ctx.docks.register({
          id: 'svelte:inspector-settings',
          title: 'Inspector settings',
          description: 'Your shortcut, keys and styles for the Svelte Inspector',
          icon: 'ph:gear-duotone',
          groupId: SVELTE_DOCK_GROUP,
          category: 'default',
          defaultOrder: 50,
          type: 'custom-render',
          renderer: {
            importFrom: `${base()}/@id/__x00__${SETTINGS_MODULE_ID.slice(1)}`,
          },
        });

        store = ctx.scope(SETTINGS_NAMESPACE).settings.global;
        server = ctx.viteServer;
        const register = (name: string, handler: (params: unknown) => Promise<ActionResult>) =>
          ctx.rpc.register({ name, type: 'action', setup: () => ({ handler: action(handler) }) });

        register(SAVE_SETTINGS, async params => {
          const result = validateSettings(params);
          if ('error' in result) return { ok: false, status: result.error };
          const saved = updateSaved(await savedOptions(), result.options, baseOptions);
          if (Object.keys(saved).length === 0) {
            await store?.delete(SAVED_OPTIONS);
            return apply('Same as the defaults, nothing to save.');
          }
          await store?.set(SAVED_OPTIONS, saved);
          log.debug('saved inspector settings', saved, 'inspector');
          return apply('Saved.');
        });

        register(RESET_SETTINGS, async () => {
          await store?.delete(SAVED_OPTIONS);
          return apply('Reset to defaults.');
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
        if (id === SETTINGS_MODULE_ID || id === SETTINGS_MODULE_ID.slice(1)) {
          return SETTINGS_MODULE_ID;
        }
        if (id === OPTIONS_MODULE_ID) {
          return id;
        }
        if (id.startsWith('virtual:vite-devtools-svelte-inspector-path:') && !id.includes('..')) {
          return id.replace('virtual:vite-devtools-svelte-inspector-path:', inspectorPath);
        }
        return null;
      },
    },
    // Only the virtual modules: Vite reads runtime files itself, which lets through files
    // reached by imports even outside `server.fs.allow` and keeps them watched.
    load: {
      filter: {
        id: {
          include: [
            /^virtual:vite-devtools-svelte-inspector-options$/,
            /^\0virtual:vite-devtools-svelte-inspector-(dock|settings)$/,
          ],
        },
      },
      async handler(id) {
        if (id === SETTINGS_MODULE_ID) {
          return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:settings-view.ts";';
        }
        if (id === DOCK_MODULE_ID) {
          return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:devtools-action.ts";';
        }
        const served: InspectorOptions = {
          ...mergeOptions(baseOptions, await savedOptions()),
          __internal: internal,
        };
        return `export default ${JSON.stringify(served)}`;
      },
    },
  };
}

import path from 'node:path';
import process from 'node:process';

import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import { INSPECTOR_ICON_SVG, INSPECTOR_SETTINGS_ICON_SVG } from './runtime/icon.js';
import { RESET_SETTINGS, SAVE_SETTINGS, SETTINGS_FILE } from './runtime/settings-constants.js';
import { changedOptions, overridingEnvFiles, validateSettings, writeSettings } from './settings.js';
import type { InspectorOptions } from './types.js';
import { log } from './utils/log.js';

/** name of the inspector plugin that ships inside vite-plugin-svelte 7 */
const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';

// vite-devtools-svelte: with Vite DevTools the inspector lives in its dock
const DOCK_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-dock';
const SETTINGS_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-settings';
const SVELTE_DOCK_GROUP = 'svelte';

type ActionResult = { ok: boolean; status: string };

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
 * Svelte Inspector as a standalone Vite plugin.
 *
 * It is always enabled once added (during `vite dev`), and it turns off the built-in
 * inspector of vite-plugin-svelte so the two never run together. To turn it off, leave the
 * plugin out.
 *
 * vite-devtools-svelte: options come from the plugin argument instead of
 * vite-plugin-svelte's `inspector` option (see `configResolved`).
 */
export function svelteInspector(options: InspectorOptions = {}): InspectorPlugin {
  const inspectorPath = getInspectorPath();
  log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

  let inspectorOptions: InspectorOptions | undefined;
  /** Vite DevTools is installed: the inspector lives in its dock */
  let dock = false;
  let root = process.cwd();
  /** Vite's envDir, `false` when it loads no env files */
  let envDir: string | false = false;
  let mode = 'development';
  /** the options without environment overrides */
  let baseOptions: InspectorOptions = defaultInspectorOptions;

  /** where SVELTE_INSPECTOR_OPTIONS is also set and wins over .env.local */
  const overridden = (dir: string) => {
    const sources = overridingEnvFiles(dir, mode);
    if (process.env.SVELTE_INSPECTOR_OPTIONS !== undefined) sources.unshift('the shell');
    return sources.length === 0
      ? ''
      : ` SVELTE_INSPECTOR_OPTIONS is also set in ${sources.join(' and ')}, which takes precedence.`;
  };

  const base = () => inspectorOptions?.__internal?.base ?? '';

  /** a settings action, which needs Vite to load env files */
  const run = (
    handler: (dir: string, params: unknown) => ActionResult,
    params: unknown,
  ): ActionResult => {
    if (envDir === false) {
      return {
        ok: false,
        status: `Vite loads no env files (envDir: false), so settings can't be saved to ${SETTINGS_FILE}. Set SVELTE_INSPECTOR_OPTIONS in the shell instead.`,
      };
    }
    try {
      return handler(envDir, params ?? {});
    } catch (error) {
      return { ok: false, status: `Couldn't save: ${(error as Error).message}` };
    }
  };

  return {
    name: 'vite-devtools-svelte-inspector',
    apply: 'serve',
    enforce: 'pre',

    applyToEnvironment(env) {
      return env.config.consumer === 'client';
    },

    configResolved(config) {
      // vite-devtools-svelte: this plugin is always on once it is added, so
      // `SVELTE_INSPECTOR_OPTIONS=true|false` does not toggle it; an options
      // object or `SVELTE_INSPECTOR_TOGGLE` still applies as a personal preference.
      const environmentOptions = parseEnvironmentOptions(config);

      dock = config.plugins.some(p => p.name.startsWith('vite:devtools'));
      if (dock) {
        log.debug('Vite DevTools found, inspector added to its dock', null, 'inspector');
      }

      baseOptions = { ...defaultInspectorOptions, ...options };
      root = config.root;
      envDir = config.envDir === false ? false : config.envDir || config.root;
      mode = config.mode;

      const { __internal: _, ...defaults } = baseOptions;
      inspectorOptions = {
        ...baseOptions,
        ...(typeof environmentOptions === 'object' ? environmentOptions : {}),
        __internal: {
          base: config.base.endsWith('/') ? config.base.slice(0, -1) : config.base,
          root: config.root,
          // what "Reset to defaults" in the settings view returns to
          defaults,
        },
      };

      // vite-devtools-svelte: vite-plugin-svelte's built-in inspector would mount a
      // second `#svelte-inspector-host` (and throw) when it is enabled through
      // `vitePlugin.inspector` or the same environment variables. Vite applies
      // `applyToEnvironment` after `configResolved`, so this keeps it out of every
      // environment.
      const builtin = config.plugins.find(p => p.name === BUILTIN_INSPECTOR_NAME);
      if (builtin) {
        builtin.applyToEnvironment = () => false;
        log.debug('disabled the built-in inspector of vite-plugin-svelte', null, 'inspector');
      }
    },
    devtools: {
      setup(ctx: DevtoolsContext) {
        if (!dock) return;

        // shared by Svelte tools (`groupId: 'svelte'`); keep one another plugin registered first
        try {
          ctx.docks.register({
            id: SVELTE_DOCK_GROUP,
            title: 'Svelte',
            icon: 'logos:svelte-icon',
            type: 'group',
            category: 'framework',
          });
        } catch (error) {
          log.debug('svelte dock group already registered', error, 'inspector');
        }

        // on the bar itself, not in the group, so the picker stays one click away
        ctx.docks.register({
          id: 'svelte:inspector',
          title: 'Svelte Inspector',
          description: 'Pick an element to open its source in your editor',
          icon: dataUrl(INSPECTOR_ICON_SVG),
          type: 'action',
          toggle: true,
          action: {
            // so the key combo works before the first click
            eager: true,
            // a url: the host would read `virtual:` as a url scheme
            importFrom: `${base()}/@id/__x00__${DOCK_MODULE_ID.slice(1)}`,
          },
        });

        ctx.docks.register({
          id: 'svelte:inspector-settings',
          title: 'Svelte Inspector settings',
          description: `Shortcut, keys and styles of the Svelte Inspector, saved to ${SETTINGS_FILE}`,
          icon: dataUrl(INSPECTOR_SETTINGS_ICON_SVG),
          groupId: SVELTE_DOCK_GROUP,
          category: 'inspector',
          type: 'custom-render',
          renderer: {
            importFrom: `${base()}/@id/__x00__${SETTINGS_MODULE_ID.slice(1)}`,
          },
        });

        const action = (name: string, handler: (dir: string, params: unknown) => ActionResult) =>
          ctx.rpc.register({
            name,
            type: 'action',
            setup: () => ({
              handler: (params: unknown) => Promise.resolve(run(handler, params)),
            }),
          });

        action(SAVE_SETTINGS, (dir, params) => {
          const result = validateSettings(params);
          if ('error' in result) return { ok: false, status: result.error };
          const changed = changedOptions(result.options, baseOptions);
          const file = writeSettings(dir, changed);
          log.debug(`saved inspector settings to ${file}`, changed, 'inspector');
          const where = path.relative(root, file) || file;
          const saved =
            Object.keys(changed).length === 0 ? 'Same as the defaults: removed from' : 'Saved to';
          return { ok: true, status: `${saved} ${where}.${overridden(dir)} Restarting…` };
        });

        action(RESET_SETTINGS, dir => {
          const file = writeSettings(dir, null);
          const where = path.relative(root, file) || file;
          return {
            ok: true,
            status: `Reset: removed from ${where}.${overridden(dir)} Restarting…`,
          };
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
            /^\0virtual:vite-devtools-svelte-inspector-(dock|settings)$/,
          ],
        },
      },
      handler(id) {
        if (id === SETTINGS_MODULE_ID) {
          return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:settings-view.ts";';
        }
        if (id === DOCK_MODULE_ID) {
          return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:devtools-action.ts";';
        }
        if (id === 'virtual:vite-devtools-svelte-inspector-options') {
          return `export default ${JSON.stringify(inspectorOptions ?? {})}`;
        }
        return null;
      },
    },
    transform: {
      // Vite+ projects install vite@npm:@voidzero-dev/vite-plus-core@latest which
      // changes the path from `vite/dist/client/client.mjs` to `vite/dist/vite/client/client.mjs`
      // Injected here rather than through transformIndexHtml, which does not reach
      // SSR-rendered pages.
      filter: {
        id: /(?:vite\/dist|vite\/dist\/vite|vite-plus-core\/dist\/vite)\/client\/client\.mjs(?:\?|$)/,
      },
      handler(code) {
        // vite-devtools-svelte: in the dock, the dock's client script mounts the inspector
        if (dock) return null;
        return {
          code: `${code}\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.ts')`,
        };
      },
    },
  };
}

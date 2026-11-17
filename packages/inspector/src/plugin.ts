import fs from 'node:fs';

import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import type { InspectorOptions } from './types.js';
import { log } from './utils/log.js';

/** `url` without its query string or hash */
function cleanUrl(url: string): string {
  const query = url.indexOf('?');
  const hash = url.indexOf('#');
  const end = Math.min(query === -1 ? url.length : query, hash === -1 ? url.length : hash);
  return url.slice(0, end);
}

/** name of the inspector plugin that ships inside vite-plugin-svelte 7 */
const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';

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
export function svelteInspector(options: InspectorOptions = {}): Plugin {
  const inspectorPath = getInspectorPath();
  log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

  let inspectorOptions: InspectorOptions | undefined;

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

      inspectorOptions = {
        ...defaultInspectorOptions,
        ...options,
        ...(typeof environmentOptions === 'object' ? environmentOptions : {}),
        __internal: {
          base: config.base.endsWith('/') ? config.base.slice(0, -1) : config.base,
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
    resolveId: {
      filter: {
        id: /^virtual:vite-devtools-svelte-inspector-/,
      },
      handler(id) {
        if (id === 'virtual:vite-devtools-svelte-inspector-options') {
          return id;
        }
        if (id.startsWith('virtual:vite-devtools-svelte-inspector-path:') && !id.includes('..')) {
          return id.replace('virtual:vite-devtools-svelte-inspector-path:', inspectorPath);
        }
        return null;
      },
    },
    load: {
      filter: {
        id: {
          include: [`${inspectorPath}/**`, /^virtual:vite-devtools-svelte-inspector-options$/],
          exclude: [/style&lang\.css$/],
        },
      },
      handler(id) {
        if (id === 'virtual:vite-devtools-svelte-inspector-options') {
          return `export default ${JSON.stringify(inspectorOptions ?? {})}`;
        }
        if (id.startsWith(inspectorPath)) {
          // read file ourselves to avoid getting shut out by vites fs.allow check
          const file = cleanUrl(id);
          if (fs.existsSync(file)) {
            return fs.promises.readFile(file, 'utf-8');
          }
          log.error(`failed to find svelte-inspector: ${id}`, null, 'inspector');
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
        return {
          code: `${code}\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.ts')`,
        };
      },
    },
  };
}

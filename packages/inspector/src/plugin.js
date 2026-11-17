/** @import { InspectorOptions } from './public.js' */
/** @import { Plugin } from 'vite' */

import { normalizePath } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import { log } from './utils/log.js';

/**
 * @param {string} url
 * @returns {string} url without query params or hash
 */
function cleanUrl(url) {
	return url.replace(/[?#].*$/s, '');
}

/** name of the inspector plugin that ships inside vite-plugin-svelte 7 */
const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';

function getInspectorPath() {
	// vite-devtools-svelte: the runtime sits next to this file instead of under
	// vite-plugin-svelte's `src/plugins/inspector/`.
	const pluginPath = normalizePath(path.dirname(fileURLToPath(import.meta.url)));
	return `${pluginPath}/runtime/`;
}

/**
 * vite-devtools-svelte: options come from the plugin argument instead of
 * vite-plugin-svelte's `inspector` option, and adding the plugin always enables
 * it (see `configResolved`).
 *
 * @param {Partial<InspectorOptions>} [options]
 * @returns {Plugin}
 */
export function svelteInspector(options = {}) {
	const inspectorPath = getInspectorPath();
	log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

	/** @type {InspectorOptions} */
	let inspectorOptions;

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
				...(typeof environmentOptions === 'object' ? environmentOptions : {})
			};

			inspectorOptions.__internal = {
				base: config.base?.replace(/\/$/, '') || ''
			};

			// vite-devtools-svelte: vite-plugin-svelte's built-in inspector would mount a
			// second `#svelte-inspector-host` (and throw) when it is enabled through
			// `vitePlugin.inspector` or the same environment variables. Vite applies
			// `applyToEnvironment` after `configResolved`, so this keeps it out of every
			// environment.
			const builtin = config.plugins.find((p) => p.name === BUILTIN_INSPECTOR_NAME);
			if (builtin) {
				builtin.applyToEnvironment = () => false;
				log.debug('disabled the built-in inspector of vite-plugin-svelte', null, 'inspector');
			}
		},
		resolveId: {
			filter: {
				id: /^virtual:vite-devtools-svelte-inspector-/
			},
			async handler(id) {
				if (id === 'virtual:vite-devtools-svelte-inspector-options') {
					return id;
				} else if (id.startsWith('virtual:vite-devtools-svelte-inspector-path:') && !id.includes('..')) {
					return id.replace('virtual:vite-devtools-svelte-inspector-path:', inspectorPath);
				}
			}
		},
		load: {
			filter: {
				id: {
					include: [`${inspectorPath}/**`, /^virtual:vite-devtools-svelte-inspector-options$/],
					exclude: [/style&lang\.css$/]
				}
			},
			async handler(id) {
				if (id === 'virtual:vite-devtools-svelte-inspector-options') {
					return `export default ${JSON.stringify(inspectorOptions ?? {})}`;
				} else if (id.startsWith(inspectorPath)) {
					// read file ourselves to avoid getting shut out by vites fs.allow check
					const file = cleanUrl(id);
					if (fs.existsSync(file)) {
						return await fs.promises.readFile(file, 'utf-8');
					} else {
						log.error(`failed to find svelte-inspector: ${id}`, null, 'inspector');
					}
				}
			}
		},
		transform: {
			// Vite+ projects install vite@npm:@voidzero-dev/vite-plus-core@latest which
			// changes the path from `vite/dist/client/client.mjs` to `vite/dist/vite/client/client.mjs`
			// TODO: inject with transformIndexHtml when it works with SSR
			filter: {
				id: /(?:vite\/dist|vite\/dist\/vite|vite-plus-core\/dist\/vite)\/client\/client\.mjs(?:\?|$)/
			},
			handler(code) {
				return { code: `${code}\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.js')` };
			}
		}
	};
}

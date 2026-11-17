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

function getInspectorPath() {
	// vite-devtools-svelte: the runtime sits next to this file instead of under
	// vite-plugin-svelte's `src/plugins/inspector/`.
	const pluginPath = normalizePath(path.dirname(fileURLToPath(import.meta.url)));
	return `${pluginPath}/runtime/`;
}

/**
 * vite-devtools-svelte: options come from the plugin argument instead of
 * vite-plugin-svelte's `inspector` option.
 *
 * @param {Partial<InspectorOptions> | boolean} [options]
 * @returns {Plugin}
 */
export function svelteInspector(options = true) {
	const inspectorPath = getInspectorPath();
	log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

	/** @type {InspectorOptions} */
	let inspectorOptions;
	let disabled = false;

	return {
		name: 'vite-devtools-svelte-inspector',
		apply: 'serve',
		enforce: 'pre',

		applyToEnvironment(env) {
			return !disabled && env.config.consumer === 'client';
		},

		configResolved(config) {
			const environmentOptions = parseEnvironmentOptions(config);
			if (environmentOptions === false) {
				log.debug('environment options set to false, inspector disabled', null, 'inspector');
				disabled = true;
				return;
			}
			const configFileOptions = options;

			if (!configFileOptions && !environmentOptions) {
				log.debug('no inspector options found, inspector disabled', null, 'inspector');
				disabled = true;
				return;
			}

			if (environmentOptions === true) {
				inspectorOptions = defaultInspectorOptions;
			} else {
				inspectorOptions = {
					...defaultInspectorOptions,
					...(typeof configFileOptions === 'object' ? configFileOptions : {}),
					...(environmentOptions || {})
				};
			}

			inspectorOptions.__internal = {
				base: config.base?.replace(/\/$/, '') || ''
			};
		},
		resolveId: {
			filter: {
				id: /^virtual:vite-devtools-svelte-inspector-/
			},
			async handler(id) {
				if (disabled) {
					return;
				}
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
				if (disabled) {
					return;
				}
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
				if (disabled) {
					return;
				}
				return { code: `${code}\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.js')` };
			}
		}
	};
}

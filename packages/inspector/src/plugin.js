/** @import { InspectorOptions } from './public.js' */
/** @import { Plugin } from 'vite' */

import { normalizePath } from 'vite';
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultInspectorOptions, parseEnvironmentOptions } from './options.js';
import { log } from './utils/log.js';
import { INSPECTOR_ICON_SVG, INSPECTOR_SETTINGS_ICON_SVG } from './runtime/icon.js';
import { changedOptions, overridingEnvFiles, validateSettings, writeSettings } from './settings.js';
import { RESET_SETTINGS, SAVE_SETTINGS, SETTINGS_FILE } from './runtime/settings-constants.js';

/**
 * @param {string} url
 * @returns {string} url without query params or hash
 */
function cleanUrl(url) {
	return url.replace(/[?#].*$/s, '');
}

/** name of the inspector plugin that ships inside vite-plugin-svelte 7 */
const BUILTIN_INSPECTOR_NAME = 'vite-plugin-svelte-inspector';

// vite-devtools-svelte: with Vite DevTools the inspector lives in its dock
const DOCK_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-dock';
const SETTINGS_MODULE_ID = '\0virtual:vite-devtools-svelte-inspector-settings';
const SVELTE_DOCK_GROUP = 'svelte';

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
 * @returns {Plugin & { devtools: { setup(ctx: any): void } }} `devtools` is the Vite DevTools hook
 */
export function svelteInspector(options = {}) {
	const inspectorPath = getInspectorPath();
	log.debug(`svelte inspector path: ${inspectorPath}`, null, 'inspector');

	/** @type {InspectorOptions} */
	let inspectorOptions;
	/** Vite DevTools is installed: the inspector lives in its dock */
	let dock = false;
	let root = process.cwd();
	/** @type {string | false} Vite's envDir, `false` when it loads no env files */
	let envDir = false;
	let mode = 'development';
	/** @type {InspectorOptions} the options without environment overrides */
	let baseOptions = defaultInspectorOptions;

	/**
	 * Where SVELTE_INSPECTOR_OPTIONS is also set and wins over .env.local
	 * @param {string} dir
	 */
	const overridden = (dir) => {
		const sources = overridingEnvFiles(dir, mode);
		if (process.env.SVELTE_INSPECTOR_OPTIONS !== undefined) sources.unshift('the shell');
		return sources.length === 0
			? ''
			: ` SVELTE_INSPECTOR_OPTIONS is also set in ${sources.join(' and ')}, which takes precedence.`;
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

			dock = config.plugins.some((p) => p.name?.startsWith('vite:devtools'));
			if (dock) {
				log.debug('Vite DevTools found, inspector added to its dock', null, 'inspector');
			}

			baseOptions = { ...defaultInspectorOptions, ...options };
			inspectorOptions = {
				...baseOptions,
				...(typeof environmentOptions === 'object' ? environmentOptions : {})
			};

			root = config.root;
			envDir = config.envDir === false ? false : config.envDir || config.root;
			mode = config.mode;

			inspectorOptions.__internal = {
				base: config.base?.replace(/\/$/, '') || '',
				root: config.root,
				// what "Reset to defaults" in the settings view returns to
				defaults: /** @type {Omit<InspectorOptions, '__internal'>} */ (
					Object.fromEntries(Object.entries(baseOptions).filter(([key]) => key !== '__internal'))
				)
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
		devtools: {
			/** @param {any} ctx */
			setup(ctx) {
				if (!dock) return;

				// shared by Svelte tools (`groupId: 'svelte'`); keep one another plugin registered first
				try {
					ctx.docks.register({
						id: SVELTE_DOCK_GROUP,
						title: 'Svelte',
						icon: 'logos:svelte-icon',
						type: 'group',
						category: 'framework'
					});
				} catch (e) {
					log.debug('svelte dock group already registered', e, 'inspector');
				}

				// on the bar itself, not in the group, so the picker stays one click away
				ctx.docks.register({
					id: 'svelte:inspector',
					title: 'Svelte Inspector',
					description: 'Pick an element to open its source in your editor',
					icon: `data:image/svg+xml;base64,${Buffer.from(INSPECTOR_ICON_SVG).toString('base64')}`,
					type: 'action',
					toggle: true,
					action: {
						// so the key combo works before the first click
						eager: true,
						// a url: the host would read `virtual:` as a url scheme
						importFrom: `${inspectorOptions.__internal?.base ?? ''}/@id/__x00__${DOCK_MODULE_ID.slice(1)}`
					}
				});

				ctx.docks.register({
					id: 'svelte:inspector-settings',
					title: 'Svelte Inspector settings',
					description: `Shortcut, keys and styles of the Svelte Inspector, saved to ${SETTINGS_FILE}`,
					icon: `data:image/svg+xml;base64,${Buffer.from(INSPECTOR_SETTINGS_ICON_SVG).toString('base64')}`,
					groupId: SVELTE_DOCK_GROUP,
					category: 'inspector',
					type: 'custom-render',
					renderer: {
						importFrom: `${inspectorOptions.__internal?.base ?? ''}/@id/__x00__${SETTINGS_MODULE_ID.slice(1)}`
					}
				});
				/**
				 * @param {string} name
				 * @param {(dir: string, params: any) => { ok: boolean; status: string }} handler
				 */
				const action = (name, handler) =>
					ctx.rpc.register({
						name,
						type: 'action',
						setup: () => ({
							handler: async (/** @type {any} */ params) => {
								if (envDir === false) {
									return {
										ok: false,
										status: `Vite loads no env files (envDir: false), so settings can't be saved to ${SETTINGS_FILE}. Set SVELTE_INSPECTOR_OPTIONS in the shell instead.`
									};
								}
								try {
									return handler(envDir, params ?? {});
								} catch (e) {
									return {
										ok: false,
										status: `Couldn't save: ${/** @type {Error} */ (e).message}`
									};
								}
							}
						})
					});
				action(SAVE_SETTINGS, (dir, params) => {
					const result = validateSettings(params);
					if ('error' in result) return { ok: false, status: result.error };
					const changed = changedOptions(result.options, baseOptions);
					const file = writeSettings(dir, changed);
					log.debug(`saved inspector settings to ${file}`, changed, 'inspector');
					const where = path.relative(root, file) || file;
					return {
						ok: true,
						status: `${Object.keys(changed).length === 0 ? 'Same as the defaults: removed from' : 'Saved to'} ${where}.${overridden(dir)} Restarting…`
					};
				});
				action(RESET_SETTINGS, (dir) => {
					const file = writeSettings(dir, null);
					const where = path.relative(root, file) || file;
					return {
						ok: true,
						status: `Reset: removed from ${where}.${overridden(dir)} Restarting…`
					};
				});
			}
		},
		resolveId: {
			filter: {
				id: /^\0?virtual:vite-devtools-svelte-inspector-/
			},
			async handler(id) {
				if (id === DOCK_MODULE_ID || id === DOCK_MODULE_ID.slice(1)) {
					return DOCK_MODULE_ID;
				} else if (id === SETTINGS_MODULE_ID || id === SETTINGS_MODULE_ID.slice(1)) {
					return SETTINGS_MODULE_ID;
				} else if (id === 'virtual:vite-devtools-svelte-inspector-options') {
					return id;
				} else if (id.startsWith('virtual:vite-devtools-svelte-inspector-path:') && !id.includes('..')) {
					return id.replace('virtual:vite-devtools-svelte-inspector-path:', inspectorPath);
				}
			}
		},
		load: {
			filter: {
				id: {
					include: [
						`${inspectorPath}/**`,
						/^virtual:vite-devtools-svelte-inspector-options$/,
						/^\0virtual:vite-devtools-svelte-inspector-(dock|settings)$/
					],
					exclude: [/style&lang\.css$/]
				}
			},
			async handler(id) {
				if (id === SETTINGS_MODULE_ID) {
					return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:settings-view.js";';
				} else if (id === DOCK_MODULE_ID) {
					return 'export { default } from "virtual:vite-devtools-svelte-inspector-path:devtools-action.js";';
				} else if (id === 'virtual:vite-devtools-svelte-inspector-options') {
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
				// vite-devtools-svelte: in the dock, the dock's client script mounts the inspector
				if (dock) {
					return;
				}
				return { code: `${code}\nimport('virtual:vite-devtools-svelte-inspector-path:load-inspector.js')` };
			}
		}
	};
}

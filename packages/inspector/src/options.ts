import process from 'node:process';

import { loadEnv } from 'vite';
import type { ResolvedConfig } from 'vite';

import type { InspectorOptions } from './types.js';
import { log } from './utils/log.js';

export const defaultInspectorOptions: InspectorOptions = {
  toggleKeyCombo: 'alt-x',
  navKeys: { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' },
  escapeKeys: ['Backspace', 'Escape'],
  openKey: 'Enter',
  openMenuKey: ' ',
  holdMode: true,
  customStyles: true,
};

/** prefix of the environment variables of vite-plugin-svelte's inspector: read, never written */
export const UPSTREAM_ENV_PREFIX = 'SVELTE_INSPECTOR';
/** prefix of this inspector's own environment variables, which win over the upstream ones */
export const ENV_PREFIX = 'SVELTE_DEVTOOLS_INSPECTOR';
/** the variable the settings view saves to */
export const OPTIONS_ENV_KEY = `${ENV_PREFIX}_OPTIONS`;

/**
 * The options set through `<prefix>_OPTIONS` (an options object) or `<prefix>_TOGGLE`.
 *
 * vite-devtools-svelte: `<prefix>_OPTIONS=true|false` sets nothing, the inspector is on
 * whenever the plugin is added.
 */
export function parseEnvironmentOptions(
  config: ResolvedConfig,
  prefix: string,
): Partial<InspectorOptions> {
  const optionsKey = `${prefix}_OPTIONS`;
  const env = loadEnv(config.mode, config.envDir ?? process.cwd(), prefix);
  const options = env?.[optionsKey];
  const toggle = env?.[`${prefix}_TOGGLE`];
  if (options) {
    try {
      const parsed: unknown = JSON.parse(options);
      if (typeof parsed === 'boolean') {
        return {};
      }
      if (typeof parsed === 'object') {
        if (parsed === null) {
          throw new TypeError('invalid type, expected object map but got null');
        }
        if (Array.isArray(parsed)) {
          throw new TypeError('invalid type, expected object map but got array');
        }
        // Values are not validated, as upstream: the options object is the user's own.
        const record = parsed as Record<string, unknown>;
        const defaultKeys = Object.keys(defaultInspectorOptions);
        const unknownKeys = Object.keys(record).filter(k => !defaultKeys.includes(k));
        if (unknownKeys.length > 0) {
          log.warn(
            `[vite-devtools-svelte-inspector] ignoring unknown options in environment ${optionsKey}: ${unknownKeys.join(', ')}`,
            null,
            'inspector',
          );
          for (const key of unknownKeys) {
            delete record[key];
          }
        }
        log.debug(`loaded environment config from ${optionsKey}`, record, 'inspector');
        return record;
      }
    } catch (e) {
      config.logger.error(
        `[vite-devtools-svelte-inspector] failed to parse inspector options from environment ${optionsKey}="${options}"\n${String(e)}`,
      );
    }
  } else if (toggle) {
    const keyConfig = {
      toggleKeyCombo: toggle,
    };
    log.debug(`loaded environment config from ${prefix}_TOGGLE`, keyConfig, 'inspector');
    return keyConfig;
  }
  return {};
}

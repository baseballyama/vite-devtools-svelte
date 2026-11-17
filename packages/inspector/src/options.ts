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
  showToggleButton: 'active',
  toggleButtonPos: 'top-right',
  customStyles: true,
};

export function parseEnvironmentOptions(
  config: ResolvedConfig,
): Partial<InspectorOptions> | boolean | undefined {
  const env = loadEnv(config.mode, config.envDir ?? process.cwd(), 'SVELTE_INSPECTOR');
  const options = env?.SVELTE_INSPECTOR_OPTIONS;
  const toggle = env?.SVELTE_INSPECTOR_TOGGLE;
  if (options) {
    try {
      const parsed: unknown = JSON.parse(options);
      if (typeof parsed === 'boolean') {
        return parsed;
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
            `[vite-plugin-svelte-inspector] ignoring unknown options in environment SVELTE_INSPECTOR_OPTIONS: ${unknownKeys.join(', ')}`,
            null,
            'inspector',
          );
          for (const key of unknownKeys) {
            delete record[key];
          }
        }
        log.debug('loaded environment config', record, 'inspector');
        return record;
      }
    } catch (e) {
      config.logger.error(
        `[vite-plugin-svelte-inspector] failed to parse inspector options from environment SVELTE_INSPECTOR_OPTIONS="${options}"\n${String(e)}`,
      );
    }
  } else if (toggle) {
    const keyConfig = {
      toggleKeyCombo: toggle,
    };
    log.debug('loaded environment config', keyConfig, 'inspector');
    return keyConfig;
  }
  return undefined;
}

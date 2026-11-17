import fs from 'node:fs';
import path from 'node:path';

import { OPTIONS_ENV_KEY } from './options.js';
import { SETTINGS_FILE } from './runtime/settings-constants.js';
import type { InspectorOptions } from './types.js';

const setsKey = (line: string) =>
  new RegExp(`^\\s*(export\\s+)?${OPTIONS_ENV_KEY}\\s*=`).test(line);

type Settings = Required<Omit<InspectorOptions, '__internal'>>;

/** `value` as a key setting, or throws a message naming `label` */
function keySetting(value: unknown, label: string): string {
  // a single space is a key (the menu key's default); anything else must not be blank
  if (typeof value !== 'string' || value === '' || (value !== ' ' && value.trim() === '')) {
    throw new Error(`${label} needs a key`);
  }
  // saved inside single quotes in the env file, which cannot be escaped
  if (value.includes("'")) throw new Error(`${label} can't be '`);
  return value;
}

/** Check the options the settings view sends before they are written to an env file */
export function validateSettings(input: unknown): { options: Settings } | { error: string } {
  try {
    if (input === null || typeof input !== 'object') throw new Error('No settings to save');
    const settings = input as Record<string, unknown>;
    const nav = (settings.navKeys ?? {}) as Record<string, unknown>;
    const escape: unknown[] = Array.isArray(settings.escapeKeys) ? settings.escapeKeys : [];
    if (escape.length === 0) throw new Error('Stop picking needs at least one key');
    return {
      options: {
        toggleKeyCombo: keySetting(settings.toggleKeyCombo, 'Shortcut').toLowerCase(),
        holdMode: settings.holdMode === true,
        openKey: keySetting(settings.openKey, 'Open in editor'),
        openMenuKey: keySetting(settings.openMenuKey, 'Component menu'),
        escapeKeys: escape.map(k => keySetting(k, 'Stop picking')),
        navKeys: {
          parent: keySetting(nav.parent, 'Parent'),
          child: keySetting(nav.child, 'First child'),
          next: keySetting(nav.next, 'Next sibling'),
          prev: keySetting(nav.prev, 'Previous sibling'),
        },
        customStyles: settings.customStyles === true,
      },
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The options in `options` that differ from `base` */
export function changedOptions(
  options: InspectorOptions,
  base: InspectorOptions,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === '__internal') continue;
    if (JSON.stringify(value) !== JSON.stringify(base[key as keyof InspectorOptions])) {
      changed[key] = value;
    }
  }
  return changed;
}

/**
 * Set `SVELTE_DEVTOOLS_INSPECTOR_OPTIONS` in `dir`'s .env.local, keeping other lines. `null` or `{}` removes
 * it, and the file if nothing else is left.
 * @returns the file written
 */
export function writeSettings(dir: string, options: Record<string, unknown> | null): string {
  const file = path.join(dir, SETTINGS_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const lines = existing === '' ? [] : existing.replace(/\r?\n$/, '').split(/\r?\n/);
  const kept = lines.filter(line => !setsKey(line));
  if (options && Object.keys(options).length > 0) {
    kept.push(`${OPTIONS_ENV_KEY}='${JSON.stringify(options)}'`);
  }
  if (kept.length > 0) {
    fs.writeFileSync(file, `${kept.join('\n')}\n`);
  } else if (existing !== '') {
    fs.rmSync(file);
  }
  return file;
}

/**
 * The env files in `dir` that Vite loads after `.env.local` for `mode` and that also set
 * `SVELTE_DEVTOOLS_INSPECTOR_OPTIONS`: their value wins over the saved settings.
 */
export function overridingEnvFiles(dir: string, mode: string): string[] {
  return [`.env.${mode}`, `.env.${mode}.local`].filter(name => {
    const file = path.join(dir, name);
    return fs.existsSync(file) && fs.readFileSync(file, 'utf-8').split(/\r?\n/).some(setsKey);
  });
}

import { same } from './runtime/settings-shared.js';
import type { Settings } from './runtime/settings-shared.js';
import type { InspectorOptions } from './types.js';

/** a single space is a key, the default menu key */
const isKey = (value: unknown): value is string =>
  typeof value === 'string' && (value === ' ' || value.trim() !== '');

/** `-` separates the keys, so no part may be empty (the minus key is saved as `minus`) */
const isCombo = (value: unknown): value is string =>
  typeof value === 'string' && value.split('-').every(isKey);

/** options that may set only some navigation keys */
export type SavedOptions = Partial<Omit<Settings, 'navKeys'>> & {
  navKeys?: Partial<Settings['navKeys']>;
};

const NAV_LABELS = {
  parent: 'Parent',
  child: 'First child',
  next: 'Next sibling',
  prev: 'Previous sibling',
} as const;

/** `value` as a key setting, or throws a message naming `label` */
function keySetting(value: unknown, label: string): string {
  if (!isKey(value)) throw new Error(`${label} needs a key`);
  return value;
}

/** check the options the settings view sends before they are saved */
export function validateSettings(input: unknown): { options: Settings } | { error: string } {
  try {
    if (input === null || typeof input !== 'object') throw new Error('No settings to save');
    const settings = input as Record<string, unknown>;
    if (!isCombo(settings.toggleKeyCombo)) throw new Error('Shortcut needs a key');
    const nav = (settings.navKeys ?? {}) as Record<string, unknown>;
    const escape: unknown[] = Array.isArray(settings.escapeKeys) ? settings.escapeKeys : [];
    if (escape.length === 0) throw new Error('Stop picking needs at least one key');
    return {
      options: {
        toggleKeyCombo: settings.toggleKeyCombo.toLowerCase(),
        holdMode: settings.holdMode === true,
        openKey: keySetting(settings.openKey, 'Open in editor'),
        openMenuKey: keySetting(settings.openMenuKey, 'Component menu'),
        escapeKeys: escape.map(k => keySetting(k, 'Stop picking')),
        navKeys: {
          parent: keySetting(nav.parent, NAV_LABELS.parent),
          child: keySetting(nav.child, NAV_LABELS.child),
          next: keySetting(nav.next, NAV_LABELS.next),
          prev: keySetting(nav.prev, NAV_LABELS.prev),
        },
        customStyles: settings.customStyles === true,
      },
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * the options in `input` the inspector can run with, from a hand-written variable or saved
 * settings: others are dropped and named in `invalid`, `navKeys` may set only some keys
 */
export function pickOptions(input: unknown): { options: SavedOptions; invalid: string[] } {
  const options: SavedOptions = {};
  const invalid: string[] = [];
  if (input === null || typeof input !== 'object') return { options, invalid };
  const record = input as Record<string, unknown>;
  const take = (key: Exclude<keyof Settings, 'navKeys'>, valid: boolean) => {
    if (!(key in record)) return;
    if (valid) Object.assign(options, { [key]: record[key] });
    else invalid.push(key);
  };
  take('toggleKeyCombo', isCombo(record.toggleKeyCombo));
  take('openKey', isKey(record.openKey));
  take('openMenuKey', isKey(record.openMenuKey));
  take('holdMode', typeof record.holdMode === 'boolean');
  take('customStyles', typeof record.customStyles === 'boolean');
  take(
    'escapeKeys',
    Array.isArray(record.escapeKeys) &&
      record.escapeKeys.length > 0 &&
      record.escapeKeys.every(isKey),
  );
  if ('navKeys' in record) {
    const nav = record.navKeys;
    if (nav === null || typeof nav !== 'object') {
      invalid.push('navKeys');
    } else {
      const picked: Partial<Settings['navKeys']> = {};
      for (const [direction, key] of Object.entries(nav)) {
        if (direction in NAV_LABELS && isKey(key)) {
          picked[direction as keyof Settings['navKeys']] = key;
        } else {
          invalid.push(`navKeys.${direction}`);
        }
      }
      options.navKeys = picked;
    }
  }
  return { options, invalid };
}

/** `base` with `patches` applied in order, `navKeys` merged key by key */
export function mergeOptions(
  base: Settings,
  ...patches: (InspectorOptions | SavedOptions | undefined)[]
): Settings {
  const merged = { ...base, navKeys: { ...base.navKeys } };
  for (const patch of patches) {
    if (!patch) continue;
    const { __internal: _, navKeys, ...rest } = patch as InspectorOptions;
    Object.assign(merged, rest);
    Object.assign(merged.navKeys, navKeys);
  }
  return merged;
}

/**
 * the saved options once `form` is saved: the options changed from what runs now (`base` with
 * `saved`) are set, or removed when they equal `base`; the others stay as they were, since
 * other projects with other defaults may rely on them
 */
export function updateSaved(saved: SavedOptions, form: Settings, base: Settings): SavedOptions {
  const current = mergeOptions(base, saved);
  const next: Record<string, unknown> = { ...saved };
  for (const [key, value] of Object.entries(form)) {
    const option = key as keyof Settings;
    if (same(value, current[option])) continue;
    if (same(value, base[option])) delete next[key];
    else next[key] = value;
  }
  return next;
}

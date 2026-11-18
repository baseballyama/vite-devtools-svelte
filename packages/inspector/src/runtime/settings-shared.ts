// shared by the plugin and the browser, so no node imports
import type { InspectorOptions } from '../types.js';

/** every option the settings view edits */
export type Settings = Required<Omit<InspectorOptions, '__internal'>>;

export type ActionResult = { ok: boolean; status: string };

export const SAVE_SETTINGS = 'svelte:inspector:save-settings';
export const RESET_SETTINGS = 'svelte:inspector:reset-settings';

/** equal values, objects compared key by key so their key order does not matter */
export function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => same(value, b[i]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const aKeys = Object.keys(a);
    const bRecord = b as Record<string, unknown>;
    return (
      aKeys.length === Object.keys(b).length &&
      aKeys.every(key => key in bRecord && same((a as Record<string, unknown>)[key], bRecord[key]))
    );
  }
  return a === b;
}

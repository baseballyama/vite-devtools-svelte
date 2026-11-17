// options are declared here so the published types never import the private inspector package
import path from 'node:path';

import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

import { svelteInspector } from '../../inspector/src/index.js';

// the build copies the runtime next to this module, see vite.config.ts
const INSPECTOR_RUNTIME = `${normalizePath(path.join(import.meta.dirname, 'inspector', 'runtime'))}/`;

/** Whether `id` is one of the inspector's own components, which devtools must not track. */
export function isInspectorRuntime(id: string): boolean {
  return normalizePath(id).startsWith(INSPECTOR_RUNTIME);
}

/**
 * Options of the Svelte Inspector, a fork of the one in `@sveltejs/vite-plugin-svelte`.
 * Environment variables (`SVELTE_DEVTOOLS_INSPECTOR_OPTIONS` with an options object,
 * `SVELTE_DEVTOOLS_INSPECTOR_TOGGLE`) take precedence over these.
 */
export interface InspectorOptions {
  /**
   * Key combo that toggles the inspector: any number of modifiers (`control`,
   * `shift`, `alt`, `meta`) followed by zero or one regular key, separated by `-`.
   * @default 'alt-x'
   */
  toggleKeyCombo?: string;
  /**
   * Keys that select elements with the keyboard.
   * @default { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' }
   */
  navKeys?: { parent: string; child: string; next: string; prev: string };
  /**
   * Key that opens the editor for the selected element.
   * @default 'Enter'
   */
  openKey?: string;
  /**
   * Key that opens the context menu for the selected element.
   * @default ' '
   */
  openMenuKey?: string;
  /**
   * Keys that close the inspector.
   * @default ['Backspace', 'Escape']
   */
  escapeKeys?: string[];
  /**
   * Close the inspector when `toggleKeyCombo` is released after a long press.
   * @default true
   */
  holdMode?: boolean;
  /**
   * Inject custom styles while the inspector is active.
   * @default true
   */
  customStyles?: boolean;
}

/** The inspector's Vite plugins, or none when `options` is `false`. */
export function inspectorPlugins(options: boolean | InspectorOptions = true): Plugin[] {
  if (options === false) return [];
  // its `devtools` hook types only the parts of the Vite DevTools context it uses
  return [svelteInspector(options === true ? {} : options) as Plugin];
}

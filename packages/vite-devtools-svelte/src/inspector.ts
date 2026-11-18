// options are declared here so the published types never import the private inspector package
import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

import { getInspectorPath, svelteInspector } from '../../inspector/src/index.js';

// where the inspector serves its runtime from: dist/inspector/runtime once built (see
// vite.config.ts), packages/inspector/src/runtime when run from source
const INSPECTOR_RUNTIME = getInspectorPath();

/** Devtools must not track the inspector's own components. */
export function isInspectorRuntime(id: string): boolean {
  return normalizePath(id).startsWith(INSPECTOR_RUNTIME);
}

/**
 * Options of the Svelte Inspector, a fork of the one in `@sveltejs/vite-plugin-svelte`.
 * Environment variables (`SVELTE_INSPECTOR_OPTIONS` with an options object,
 * `SVELTE_INSPECTOR_TOGGLE`) take precedence over these, and the settings saved in the
 * Vite DevTools dock take precedence over both.
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

export function inspectorPlugin(options: InspectorOptions = {}): Plugin {
  // its `devtools` hook types only the parts of the Vite DevTools context it uses
  return svelteInspector(options) as Plugin;
}

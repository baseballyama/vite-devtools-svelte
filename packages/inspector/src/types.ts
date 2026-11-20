import type { Settings } from './runtime/settings-shared.js';

export interface InspectorOptions {
  toggleKeyCombo?: string;
  navKeys?: { parent: string; child: string; next: string; prev: string };
  openKey?: string;
  openMenuKey?: string;
  escapeKeys?: string[];
  holdMode?: boolean;
  customStyles?: boolean;
  /** set by the plugin, not by users */
  __internal?: {
    base: string;
    // the directory Svelte makes `__svelte_meta.loc.file` relative to (its `rootDir`, which
    // defaults to process.cwd()), to open files by absolute path through Vite DevTools
    cwd: string;
    // what the settings view resets to
    defaults: Settings;
  };
}

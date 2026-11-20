import { HOOKS_MODULE_ID } from './ids.js';

const SVELTE_MODULE_SUFFIXES = ['js', 'ts', 'mjs', 'mts', 'cjs', 'cts'].map(
  ext => `.svelte.${ext}`,
);

/** `file` must have no query. */
export function isSvelteModule(file: string): boolean {
  return SVELTE_MODULE_SUFFIXES.some(suffix => file.endsWith(suffix));
}

// Imports the hooks first in one client Svelte module, so its signals (shared
// state such as `export const cart = $state(...)`) are seen even when the
// module runs before any component. Components get the same import from the
// compiler (`experimental.devtools`), which vite-plugin-svelte does not pass
// on to modules. Prepended on the first line, so every original line keeps
// its number. `null` for a server-compiled module.
export function injectModuleTracking(code: string): string | null {
  if (code.includes('svelte/internal/server')) return null;
  return `import '${HOOKS_MODULE_ID}';` + code;
}

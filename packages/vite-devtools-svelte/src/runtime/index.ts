// Browser code the plugin serves from disk: the Svelte compiler imports the
// hooks by path (`experimental.devtools`), and the hooks import the runtime
// (runtime.js) next to them; the in-page inspector imports inspector-link.js.
// The build copies them next to the bundle, so the same relative URLs work
// from `src` and `dist`.
import { fileURLToPath } from 'node:url';

export { HOOKS_MODULE_ID } from './ids.js';

// A variable, not a literal: Vite's lib build would turn
// `new URL('./hooks.js', import.meta.url)` into an inlined asset.
const HOOKS_FILE_NAME = './hooks.js';
const INSPECTOR_LINK_FILE_NAME = './inspector-link.js';

/**
 * Absolute path of `hooks.js`: creates the devtools store (runtime.js) and
 * subscribes it to Svelte's devtools events (`svelte/internal/devtools`).
 */
export const HOOKS_FILE: string = fileURLToPath(new URL(HOOKS_FILE_NAME, import.meta.url));

/** Absolute path of `inspector-link.js`: what the in-page inspector calls on the DevTools. */
export const INSPECTOR_LINK_FILE: string = fileURLToPath(
  new URL(INSPECTOR_LINK_FILE_NAME, import.meta.url),
);

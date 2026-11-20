// The Svelte compiler imports the hooks by path (`experimental.devtools`), and
// the hooks import runtime.js next to them. The build copies both next to the
// bundle, so the same relative URLs work from `src` and `dist`.
import { fileURLToPath } from 'node:url';

export { HOOKS_MODULE_ID } from './ids.js';

// A variable, not a literal: Vite's lib build would turn
// `new URL('./hooks.js', import.meta.url)` into an inlined asset.
const HOOKS_FILE_NAME = './hooks.js';

// Creates the devtools store (runtime.js) and subscribes it to Svelte's
// devtools events (`svelte/internal/devtools`).
export const HOOKS_FILE: string = fileURLToPath(new URL(HOOKS_FILE_NAME, import.meta.url));

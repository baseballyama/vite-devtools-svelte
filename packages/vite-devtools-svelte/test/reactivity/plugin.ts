// Vite plugin for the reactivity integration tests: the same module wiring
// the dev server gets from svelteDevtools() (the hooks file and its alias,
// the Svelte module transform), without a dev
// server, devframe or MCP. Components import the hooks through the compiler
// option the plugin adds (see vitest.config.ts: `experimental.devtools`).
// The in-page inspector is the built inspector plugin itself, with the DevTools
// link and the default options.
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import { svelteInspector } from 'vite-devtools-svelte-inspector';

import { HOOKS_MODULE_ID } from '../../src/runtime/ids.js';
import { injectModuleTracking, isSvelteModule } from '../../src/runtime/transform.js';

export const HOOKS_FILE = fileURLToPath(new URL('../../src/runtime/hooks.js', import.meta.url));
const INSPECTOR_LINK_FILE = fileURLToPath(
  new URL('../../src/runtime/inspector-link.js', import.meta.url),
);

export function reactivityHarnessPlugin(): Plugin[] {
  return [
    {
      name: 'reactivity-harness:modules',
      enforce: 'pre',
      resolveId(id) {
        return id === HOOKS_MODULE_ID ? HOOKS_FILE : null;
      },
    },
    svelteInspector({}, { devtools: INSPECTOR_LINK_FILE }),
    {
      name: 'reactivity-harness:tracking',
      enforce: 'post',
      transform(code, id, options) {
        if (id.includes('node_modules') || options?.ssr) return null;
        const file = id.split('?')[0]!;
        const modified = isSvelteModule(file) ? injectModuleTracking(code) : null;
        return modified === null ? null : { code: modified, map: null };
      },
    },
  ];
}

import { fileURLToPath } from 'node:url';

import { normalizePath } from 'vite';
import type { Plugin } from 'vite';

const MODULE = normalizePath(fileURLToPath(new URL('../src/server/sv-addons.ts', import.meta.url)));

/**
 * Replaces src/server/sv-addons.ts with the list it computes, so the build does not bundle
 * sv's whole engine (~850 KB minified; `officialAddons` does not tree-shake) for it.
 */
export function svAddons(): Plugin {
  let inlined = false;
  return {
    name: 'sv-addons',
    apply: 'build',
    async load(id) {
      if (normalizePath(id) !== MODULE) return undefined;
      const { svAddons: list } = await import('../src/server/sv-addons.js');
      inlined = true;
      return `export const svAddons = ${JSON.stringify(list)};`;
    },
    buildEnd(error) {
      if (!error && !inlined) this.error(`${MODULE} was not inlined; the build would bundle sv`);
    },
  };
}

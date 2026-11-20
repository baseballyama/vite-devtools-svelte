import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { minifySync, normalizePath } from 'vite';
import type { Plugin } from 'vite';

const RUNTIME_DIR = fileURLToPath(new URL('../src/runtime/', import.meta.url));
const RUNTIME_FILES = ['page-runtime.js', 'wrapper.js'];

// The browser runtime is sent as text into every dev page, where its comments and
// whitespace are dead weight. Names are not mangled, so errors from it stay readable.
export function minifyRuntimeSource(file: string): string {
  const result = minifySync(file, fs.readFileSync(RUNTIME_DIR + file, 'utf8'), {
    compress: false,
    mangle: false,
  });
  if (result.errors.length > 0) {
    throw new Error(`minifying src/runtime/${file}: ${result.errors[0]!.message}`);
  }
  return result.code;
}

/** Serves the `?raw` imports of the runtime files minified, so tests run the shipped text. */
export function minifyRuntime(): Plugin {
  const ids = new Map<string, string>(
    RUNTIME_FILES.map(file => [`${normalizePath(RUNTIME_DIR + file)}?raw`, file]),
  );
  return {
    name: 'minify-runtime',
    enforce: 'pre',
    load(id) {
      const file = ids.get(normalizePath(id));
      if (file === undefined) return null;
      // A `?raw` id is not a real path, so `vite build --watch` only rebuilds on edits if told.
      this.addWatchFile(RUNTIME_DIR + file);
      return `export default ${JSON.stringify(minifyRuntimeSource(file))};`;
    },
  };
}

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, normalizePath } from 'vite';
import type { Plugin } from 'vite';
import dts from 'vite-plugin-dts';

import { minifyRuntime } from './build/minify-runtime.js';

// the bundled inspector serves its runtime from disk at runtime next to its own chunk
const INSPECTOR_SRC = normalizePath(fileURLToPath(new URL('../inspector/src/', import.meta.url)));
const INSPECTOR_RUNTIME = fileURLToPath(new URL('../inspector/src/runtime/', import.meta.url));
/** the inspector's chunk, at a fixed path so its runtime can sit next to it */
const INSPECTOR_CHUNK = 'inspector/index';

function copyInspectorRuntime(): Plugin {
  return {
    name: 'copy-inspector-runtime',
    apply: 'build',
    writeBundle(options) {
      fs.cpSync(INSPECTOR_RUNTIME, `${options.dir}/inspector/runtime`, {
        recursive: true,
        // types for this repo only
        filter: src => !src.endsWith('.d.ts'),
      });
    },
  };
}

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      entryRoot: 'src',
      // the public entry's type graph; env.d.ts types the `?raw` imports
      include: [
        'src/index.ts',
        'src/plugin.ts',
        'src/inspector.ts',
        'src/types.ts',
        'src/env.d.ts',
      ],
    }),
    minifyRuntime(),
    copyInspectorRuntime(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // A Node-side plugin: readable stack traces in the user's dev server beat a smaller file.
    minify: false,
    target: 'node22',
    lib: {
      entry: { index: 'src/index.ts', cli: 'src/cli/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.mjs`,
    },
    rolldownOptions: {
      external: ['vite', /^devframe(\/|$)/, /^node:/],
      output: {
        chunkFileNames: chunk =>
          chunk.name === INSPECTOR_CHUNK ? '[name].mjs' : '[name]-[hash].mjs',
        codeSplitting: {
          groups: [
            { name: INSPECTOR_CHUNK, test: id => normalizePath(id).startsWith(INSPECTOR_SRC) },
          ],
        },
      },
    },
  },
});

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, normalizePath } from 'vite';
import type { Plugin } from 'vite';
import dts from 'vite-plugin-dts';

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
      include: ['src/**/*.ts'],
    }),
    copyInspectorRuntime(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'node22',
    lib: {
      entry: { index: 'src/index.ts', cli: 'src/cli/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.mjs`,
    },
    rolldownOptions: {
      external: [
        'vite',
        /^@vitejs\/devtools-kit/,
        /^devframe(\/|$)/,
        /^node:/,
        'fs',
        'fs/promises',
        'path',
        'url',
        'crypto',
        'http',
        'https',
        'os',
        'stream',
        'util',
      ],
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

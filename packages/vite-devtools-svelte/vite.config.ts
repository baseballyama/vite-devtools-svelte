import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import dts from 'vite-plugin-dts';

// the bundled inspector serves its runtime from disk at runtime next to its own chunk
const INSPECTOR_SRC = /[\\/]packages[\\/]inspector[\\/]src[\\/]/;
const INSPECTOR_RUNTIME = fileURLToPath(new URL('../inspector/src/runtime/', import.meta.url));

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
    target: 'node18',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rolldownOptions: {
      external: [
        'vite',
        /^@vitejs\/devtools-kit/,
        /^devframe(\/|$)/,
        /^@modelcontextprotocol\/sdk/,
        'zod',
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
        chunkFileNames: '[name].mjs',
        codeSplitting: {
          groups: [{ name: 'inspector/index', test: INSPECTOR_SRC }],
        },
      },
    },
  },
});

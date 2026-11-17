import fs from 'node:fs';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// The inspector's browser files (the app's Vite compiles them), as its own build copies them
// next to its bundle: bundled into index.mjs, its plugin serves them from `runtime/` next to
// itself. (`build:plugin` builds the inspector first.)
const INSPECTOR_RUNTIME = new URL(
  'runtime/',
  import.meta.resolve('vite-devtools-svelte-inspector'),
);

export default defineConfig({
  plugins: [
    {
      // Served from disk next to the bundle (see src/runtime/index.ts)
      name: 'emit-browser-files',
      generateBundle() {
        for (const fileName of ['hooks.js', 'runtime.js', 'inspector-link.js']) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: fs.readFileSync(new URL(`src/runtime/${fileName}`, import.meta.url), 'utf8'),
          });
        }
        for (const fileName of ['Inspector.svelte', 'load-inspector.ts']) {
          this.emitFile({
            type: 'asset',
            fileName: `runtime/${fileName}`,
            source: fs.readFileSync(new URL(fileName, INSPECTOR_RUNTIME), 'utf8'),
          });
        }
      },
    },
    dts({
      tsconfigPath: './tsconfig.build.json',
      entryRoot: 'src',
      include: ['src/**/*.ts'],
    }),
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
        'obug',
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
    },
  },
});

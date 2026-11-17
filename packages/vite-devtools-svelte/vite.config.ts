import fs from 'node:fs';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    {
      // Served from disk next to the bundle (see src/runtime/index.ts)
      name: 'emit-browser-files',
      generateBundle() {
        for (const fileName of ['hooks.js', 'runtime.js']) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: fs.readFileSync(new URL(`src/runtime/${fileName}`, import.meta.url), 'utf8'),
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

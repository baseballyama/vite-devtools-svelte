import { cpSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// The plugin is bundled into dist/index.mjs. The browser runtime (`src/runtime/`) is not:
// the plugin serves those files as-is into the user's app (see `getInspectorPath()`), so
// they are copied next to the bundle and compiled by the app's own Vite pipeline.
export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      entryRoot: 'src',
    }),
    {
      name: 'copy-inspector-runtime',
      apply: 'build',
      writeBundle(options) {
        const outDir = options.dir ?? 'dist';
        cpSync(path.resolve(import.meta.dirname, 'src/runtime'), path.join(outDir, 'runtime'), {
          recursive: true,
          filter: source => !source.endsWith('.d.ts'),
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // A Node-side plugin: readable stack traces in the user's dev server beat a smaller file.
    minify: false,
    target: 'node22',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rolldownOptions: {
      external: ['vite', 'obug', /^node:/],
    },
  },
});

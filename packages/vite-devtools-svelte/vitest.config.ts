import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

import { minifyRuntime } from './build/minify-runtime.js';
import { reactivityHarnessPlugin } from './test/reactivity/plugin.js';

export default defineConfig({
  test: {
    // The whole package, so files only reached through integration tests count too.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // types / re-exports only
        'src/types.ts',
        'src/index.ts',
        'src/env.d.ts',
        // Evaluated as text (`?raw` / `new Function`), so V8 cannot attribute
        // coverage to them; covered by test/perf and test/reactivity instead.
        'src/runtime/page-runtime.js',
        'src/runtime/wrapper.js',
      ],
      reporter: ['text', 'json-summary'],
      // Floors at the level reached, so coverage cannot silently regress.
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 97,
        lines: 99,
        'src/plugin.ts': { statements: 98, branches: 95, functions: 91, lines: 98 },
        'src/server/collector.ts': { statements: 98, branches: 94, functions: 100, lines: 99 },
        'src/server/mount.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/runtime/{ids,index,transform}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
    projects: [
      {
        plugins: [minifyRuntime()],
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/reactivity/**'],
        },
      },
      {
        // Harness first, as svelteDevtools() is listed before sveltekit():
        // .svelte.ts modules are then compiled after the tracking transform.
        plugins: [
          reactivityHarnessPlugin(),
          svelte({ compilerOptions: { dev: true }, configFile: false }),
        ],
        resolve: { conditions: ['browser'] },
        test: {
          name: 'reactivity',
          include: ['test/reactivity/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});

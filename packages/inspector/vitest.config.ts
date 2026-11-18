import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/*.test.ts'],
        },
      },
      {
        // The browser runtime (`src/runtime/`), compiled for the client and run in happy-dom.
        // Its virtual modules point at fixtures instead of the plugin.
        plugins: [svelte({ configFile: false })],
        resolve: {
          conditions: ['browser'],
          alias: {
            'virtual:vite-devtools-svelte-inspector-options': here('test/runtime/options.ts'),
            'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte': here(
              'src/runtime/Inspector.svelte',
            ),
          },
        },
        test: {
          name: 'runtime',
          include: ['test/runtime/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
    // `vitest run --coverage` (`pnpm test:coverage`)
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // types / re-exports only
        'src/types.ts',
        'src/index.ts',
        // Browser runtime, served to the app as files and compiled by its Vite: the `runtime`
        // tests cover its behaviour, but it is not held to the plugin's coverage floors.
        'src/runtime/**',
      ],
      reporter: ['text', 'json-summary'],
      // Floors at the level reached (Nov 2026), so coverage cannot silently regress.
      thresholds: {
        statements: 100,
        branches: 90,
        functions: 100,
        lines: 100,
      },
    },
  },
});

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The DevTools UI only ever runs in the browser: compile `.svelte` /
// `.svelte.ts` (and `.svelte.test.ts`) for the client and resolve Svelte's
// client runtime, so `$effect` runs. Two projects:
// - `client`: modules and rune modules, in Node (the SSR transform, with
//   browser conditions);
// - `dom`: component tests (`*.dom.test.ts`), rendered with
//   @testing-library/svelte into happy-dom.
export default defineConfig({
  plugins: [svelte({ dynamicCompileOptions: () => ({ generate: 'client' }) })],
  ssr: { resolve: { conditions: ['browser'] } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: {
          name: 'dom',
          include: ['src/**/*.dom.test.ts'],
          environment: 'happy-dom',
          setupFiles: ['@testing-library/svelte/vitest', './src/test/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.svelte'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        // Entry point (mounts the app) and type-only modules.
        'src/main.ts',
        'src/lib/types.ts',
        'src/components/types.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        // Everything together (modules + components).
        lines: 99,
        statements: 99,
        functions: 98,
        branches: 91,
        // Every module, not just the total; functions stays below 100 for an
        // unreachable guard in rpc.
        'src/**/*.ts': { perFile: true, lines: 100, statements: 99, functions: 98, branches: 97 },
        // Branch counts include compiler-generated template branches (a
        // one-element Badge reports 2), so the per-file floor is low; the
        // total above holds the real bar.
        'src/**/*.svelte': {
          perFile: true,
          lines: 97,
          statements: 96,
          functions: 95,
          branches: 50,
        },
      },
    },
  },
});

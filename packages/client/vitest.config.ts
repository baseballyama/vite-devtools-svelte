import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Tests run in Node (the SSR transform), but the DevTools UI only ever runs
// in the browser: compile `.svelte` / `.svelte.ts` (and `.svelte.test.ts`)
// for the client and resolve Svelte's client runtime, so `$effect` runs.
export default defineConfig({
  plugins: [svelte({ dynamicCompileOptions: () => ({ generate: 'client' }) })],
  ssr: { resolve: { conditions: ['browser'] } },
  test: {
    name: 'client',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/lib/testing.svelte.ts',
        // Entry point (mounts the app) and type-only modules.
        'src/main.ts',
        'src/lib/types.ts',
        'src/components/types.ts',
      ],
      reporter: ['text', 'html'],
      // Every module, not just the total: the weakest file reaches 97.3 %
      // branches (graph-layout) and 98.1 % functions (rpc, an unreachable
      // guard); all lines are covered.
      thresholds: { perFile: true, lines: 100, statements: 99, functions: 98, branches: 97 },
    },
  },
})

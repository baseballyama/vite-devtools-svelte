import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

import { reactivityHarnessPlugin } from './test/reactivity/plugin.js'

export default defineConfig({
  test: {
    // `vitest run --coverage` (`pnpm test:coverage`): the whole package's
    // sources, so files only reached through integration tests count too.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // types / re-exports only
        'src/types.ts',
        'src/index.ts',
        'src/env.d.ts',
        // Browser sources served as text (`?raw`, or read from disk by the
        // reactivity harness) and evaluated under a virtual module id or
        // `new Function`: V8 cannot attribute that execution to these files,
        // so they would always read ~0%. Their behaviour is covered by
        // test/perf (runtime in a fake browser) and test/reactivity (real
        // Svelte components through the wrapper).
        'src/runtime/client.js',
        'src/runtime/wrapper.js',
        // The prompt toolbar's wrapper additions (covered by
        // test/reactivity/inspect.test.ts) and its DOM layer (covered by
        // e2e/prompt-toolbar.mjs in a real browser). Its markdown helpers,
        // `prompt-format.js`, are imported directly by the unit tests and
        // stay in the report.
        'src/runtime/wrapper-toolbar.js',
        'src/runtime/prompt-toolbar.js',
      ],
      reporter: ['text', 'json-summary'],
      // Floors at the level reached (Oct 2026), so coverage cannot silently
      // regress. Per file for the plugin core; the package total as a whole.
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 97,
        lines: 99,
        'src/plugin.ts': { statements: 98, branches: 95, functions: 91, lines: 98 },
        'src/server/collector.ts': { statements: 98, branches: 94, functions: 100, lines: 99 },
        'src/server/mount.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/server/template-injector.ts': {
          statements: 96,
          branches: 95,
          functions: 100,
          lines: 100,
        },
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
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/reactivity/**'],
        },
      },
      {
        // Real Svelte components (dev compile) through the production wrapper
        // and runtime, in a DOM: the reactivity mechanism end to end.
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
          exclude: ['test/reactivity/inspect.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        // The same, with `promptToolbar: true`: the wrapper also records which
        // instance rendered each element. A project of its own so the tests
        // above keep running the wrapper users get by default.
        plugins: [
          reactivityHarnessPlugin({ promptToolbar: true }),
          svelte({ compilerOptions: { dev: true }, configFile: false }),
        ],
        resolve: { conditions: ['browser'] },
        test: {
          name: 'inspect',
          include: ['test/reactivity/inspect.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
})

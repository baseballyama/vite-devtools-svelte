import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { reactivityHarnessPlugin } from './src/__tests__/reactivity/plugin.js'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'client/src/**/*.test.ts'],
          exclude: ['src/__tests__/reactivity/**'],
        },
      },
      {
        // Real Svelte components (dev compile) through the production wrapper
        // and runtime, in a DOM: the reactivity mechanism end to end.
        plugins: [
          svelte({ compilerOptions: { dev: true }, configFile: false }),
          reactivityHarnessPlugin(),
        ],
        resolve: { conditions: ['browser'] },
        test: {
          name: 'reactivity',
          include: ['src/__tests__/reactivity/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
})

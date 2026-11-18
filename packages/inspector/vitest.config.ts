import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `vitest run --coverage` (`pnpm test:coverage`)
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // types / re-exports only
        'src/types.ts',
        'src/index.ts',
        // Browser runtime, served to the app as files and compiled by its Vite: it never
        // runs in this Node process, so V8 cannot attribute any execution to it.
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

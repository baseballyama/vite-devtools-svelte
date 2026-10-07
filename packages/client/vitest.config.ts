import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'client',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})

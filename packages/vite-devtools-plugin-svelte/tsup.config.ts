import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: false,
  external: ['vite', '@vitejs/devtools-kit'],
  outDir: 'dist',
})

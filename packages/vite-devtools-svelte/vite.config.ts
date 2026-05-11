import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      entryRoot: 'src',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
      outDir: 'dist',
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'node18',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [
        'vite',
        '@vitejs/devtools-kit',
        /^node:/,
        'fs',
        'fs/promises',
        'path',
        'url',
        'crypto',
        'http',
        'https',
        'os',
        'stream',
        'util',
      ],
    },
  },
})

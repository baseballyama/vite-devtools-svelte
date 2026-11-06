import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      entryRoot: 'src',
      include: ['src/**/*.ts'],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'node18',
    lib: {
      // `prompt-format` is a separate module because the served toolbar imports
      // it: the helpers are TypeScript, unit-tested and shipped compiled.
      entry: {
        index: 'src/index.ts',
        'prompt-format': 'src/runtime/prompt-format.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.mjs`,
    },
    rolldownOptions: {
      external: [
        'vite',
        /^@vitejs\/devtools-kit/,
        /^devframe(\/|$)/,
        /^@modelcontextprotocol\/sdk/,
        'zod',
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

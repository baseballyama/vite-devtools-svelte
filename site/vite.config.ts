import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(
    resolve(__dirname, '../packages/vite-devtools-svelte/package.json'),
    'utf-8',
  ),
) as { version: string }

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import adapter from '@sveltejs/adapter-static'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../packages/vite-devtools-svelte/package.json'), 'utf-8'),
) as { version: string }

const dev = process.env.NODE_ENV !== 'production'
const base = process.env.BASE_PATH ?? (dev ? '' : '/vite-devtools-svelte')

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        fallback: '404.html',
        precompress: false,
        strict: true,
      }),
      paths: {
        // Kit validates the value; the type is narrower than process.env's.
        base: base as '' | `/${string}`,
      },
      prerender: {
        handleHttpError: 'warn',
      },
    }),
  ],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})

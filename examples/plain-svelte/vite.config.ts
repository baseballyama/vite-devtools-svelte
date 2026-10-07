// Plain Svelte + Vite (no SvelteKit). `SVELTE_DEVTOOLS_DOCK=1` adds `@vitejs/devtools`
// (the plugin then mounts into its dock); otherwise the plugin serves
// /.svelte-devtools/ itself (standalone).
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

const dock = process.env.SVELTE_DEVTOOLS_DOCK === '1'

export default defineConfig(async () => ({
  plugins: [
    svelteDevtools(),
    ...(dock ? [(await import('@vitejs/devtools')).DevTools()] : []),
    svelte(),
  ],
}))

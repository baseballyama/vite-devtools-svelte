// Standalone profile for the compat smoke tests (e2e/compat): the same
// app without `@vitejs/devtools`, so the plugin serves /.svelte-devtools/
// itself. The default vite.config.ts (dock mode) is unchanged.
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

export default defineConfig({
  plugins: [svelteDevtools(), sveltekit()],
})

// Standalone profile for the compat smoke tests (scripts/compat): the same
// app without `@vitejs/devtools`, so the plugin serves /.svelte-devtools/
// itself. The default vite.config.ts (dock mode) is unchanged.
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteDevtools } from 'vite-devtools-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelteDevtools(), sveltekit()],
})

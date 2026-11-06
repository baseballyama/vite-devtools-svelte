// Standalone profile for the compat smoke tests (e2e/compat): the same
// app without `@vitejs/devtools`, so the plugin serves /.svelte-devtools/
// itself. The default vite.config.ts (dock mode) is unchanged.
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

// The prompt toolbar is opt-in: e2e/prompt-toolbar.mjs turns it on through the
// environment, so the compat smoke tests keep their untouched pages.
const promptToolbar = process.env.SVELTE_DEVTOOLS_PROMPT_TOOLBAR === '1'

export default defineConfig({
  plugins: [svelteDevtools({ promptToolbar }), sveltekit()],
})

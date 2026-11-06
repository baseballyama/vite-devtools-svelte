// Base-path profile for e2e/prompt-toolbar.mjs: the same app served under
// `/app/`, so the toolbar's `/@fs` source reads have to respect the base (a
// bare `/@fs/...` request 404s in Vite's base middleware).
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

const promptToolbar = process.env.SVELTE_DEVTOOLS_PROMPT_TOOLBAR === '1'

export default defineConfig({
  plugins: [svelteDevtools({ promptToolbar }), sveltekit({ paths: { base: '/app' } })],
})

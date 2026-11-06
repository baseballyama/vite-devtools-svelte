import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

// The prompt toolbar is opt-in: SVELTE_DEVTOOLS_PROMPT_TOOLBAR=1 turns it on.
const promptToolbar = process.env.SVELTE_DEVTOOLS_PROMPT_TOOLBAR === '1'

export default defineConfig({
  plugins: [svelteDevtools({ promptToolbar }), DevTools(), sveltekit()],
})

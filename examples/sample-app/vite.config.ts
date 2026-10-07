import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})

import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { svelteDevtools } from 'vite-devtools-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})

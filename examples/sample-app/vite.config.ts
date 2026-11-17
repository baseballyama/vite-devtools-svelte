import { sveltekit } from '@sveltejs/kit/vite'
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte'
import { DevTools } from '@vitejs/devtools'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})

import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../vite-devtools-svelte/dist/client',
    emptyOutDir: true,
  },
  base: '/.svelte-devtools/',
})

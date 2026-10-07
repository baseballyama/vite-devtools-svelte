import adapter from '@sveltejs/adapter-auto'
import { sveltekit } from '@sveltejs/kit/vite'
import { DevTools } from '@vitejs/devtools'
import { defineConfig } from 'vite'
import { svelteDevtools } from 'vite-devtools-svelte'

export default defineConfig({
  plugins: [
    // svelteDevtools must come before sveltekit so that
    // $effect transform runs before the Svelte compiler
    svelteDevtools(),
    DevTools(),
    sveltekit({ adapter: adapter() }),
  ],
})

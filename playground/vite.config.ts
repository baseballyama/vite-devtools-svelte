import { sveltekit } from '@sveltejs/kit/vite'
import { svelteDevtools } from 'vite-devtools-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // svelteDevtools must come before sveltekit so that
    // $effect transform runs before the Svelte compiler
    svelteDevtools(),
    sveltekit(),
  ],
})

import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  devtools: { apply: 'serve' },
  plugins: [
    // svelteDevtools must come before sveltekit so that
    // $effect transform runs before the Svelte compiler
    svelteDevtools(),
    sveltekit({ adapter: adapter() }),
  ],
});

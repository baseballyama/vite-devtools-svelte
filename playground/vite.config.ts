import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { DevTools } from '@vitejs/devtools';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // svelteDevtools must come before sveltekit so that
    // $effect transform runs before the Svelte compiler
    svelteDevtools(),
    DevTools(),
    sveltekit({ adapter: adapter() }),
  ],
});

// Standalone profile for the compat smoke tests (e2e/compat): the same
// app without `@vitejs/devtools`, so the plugin serves /.svelte-devtools/
// itself.
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelteDevtools(), sveltekit({ adapter: adapter() })],
});

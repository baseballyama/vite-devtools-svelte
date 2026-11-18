// SvelteKit 3: the Kit config is passed to the `sveltekit()` Vite plugin
// (no svelte.config.js). `SVELTE_DEVTOOLS_DOCK=1` turns on Vite DevTools.
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

const dock = process.env.SVELTE_DEVTOOLS_DOCK === '1';

export default defineConfig({
  devtools: dock && { apply: 'serve' },
  plugins: [svelteDevtools(), sveltekit({ adapter: adapter() })],
});

// For svelte-check only: without it, svelte-check looks for the Svelte config in vite.config.ts
// (which builds the plugin and has no Svelte plugin). Inspector.svelte needs no preprocessing:
// it is compiled by the app's own vite-plugin-svelte.
export default {};

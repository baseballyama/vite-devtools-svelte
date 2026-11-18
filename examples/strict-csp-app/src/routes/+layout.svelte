<script lang="ts">
  import type { LayoutProps } from './$types';

  // No `@vitejs/devtools/client/inject` import: vite-devtools-svelte injects
  // the dock script into SvelteKit pages itself.
  let { children }: LayoutProps = $props();
</script>

{@render children()}

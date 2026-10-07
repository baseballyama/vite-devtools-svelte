<script lang="ts">
  import type { LayoutProps } from './$types'

  // No manual `@vitejs/devtools/client/inject` import (the old #51 workaround):
  // that module no longer exists in @vitejs/devtools >= 0.7.6, and
  // vite-devtools-svelte injects the dock script into SvelteKit pages itself.
  let { children }: LayoutProps = $props()
</script>

{@render children()}

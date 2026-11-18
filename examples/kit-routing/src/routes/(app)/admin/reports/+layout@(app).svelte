<!-- `+layout@(app).svelte`: inherits the (app) layout but not admin/+layout.svelte. -->
<script lang="ts">
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<div class="reports">{@render children()}</div>

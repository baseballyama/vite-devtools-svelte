<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let width = $state(0);
</script>

<svelte:window bind:innerWidth={width} />

<h1>ssr = false</h1>
<p data-testid="where">Rendered in the {data.renderedIn}; window is {width}px wide.</p>

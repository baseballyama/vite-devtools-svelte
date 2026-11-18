<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let clicks = $state(0);
  let doubled = $derived(clicks * 2);
</script>

<svelte:head>
  <title>kit-ssg — home</title>
  <meta property="og:title" content="kit-ssg home" />
  <meta
    property="og:description"
    content="Prerendered SvelteKit example for vite-devtools-svelte"
  />
</svelte:head>

<h1>{data.greeting}</h1>
<p>Hydrated after prerender: the counter is live.</p>
<button type="button" data-testid="count" onclick={() => clicks++}
  >clicked {clicks} (×2 = {doubled})</button
>

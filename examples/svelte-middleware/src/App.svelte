<script lang="ts">
  import { onMount } from 'svelte';

  import type { AppProps } from './entry-server.ts';
  import Checklist from './lib/Checklist.svelte';
  import Clock from './lib/Clock.svelte';
  import Counter from './lib/Counter.svelte';

  let { renderedAt, url, initialCount, items }: AppProps = $props();
  // false in the server HTML; flips once hydrate() has run in the browser.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
</script>

<svelte:head>
  <meta
    name="description"
    content="Svelte rendered by a custom server with Vite in middleware mode"
  />
</svelte:head>

<h1>svelte-middleware</h1>
<p>
  Rendered on the server at <code>{renderedAt}</code> for <code>{url}</code>.
  <strong data-testid="hydrated">{hydrated ? 'hydrated' : 'server HTML only'}</strong>
</p>

<Counter initial={initialCount} />
<Checklist {items} />
<Clock />

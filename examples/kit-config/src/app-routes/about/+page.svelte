<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let open = $state(false);
</script>

<h1>About</h1>
<p data-testid="where">This load ran in the {data.where} (layout loaded at {data.since}).</p>
<button type="button" data-testid="toggle" onclick={() => (open = !open)}
  >{open ? 'hide' : 'show'} details</button
>
{#if open}
  <p>
    Routes live in <code>src/app-routes</code>, the app is served under <code>/base</code> and its
    assets under <code>/base/_custom_app</code>.
  </p>
{/if}

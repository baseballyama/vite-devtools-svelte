<script lang="ts">
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();

  let range = $state(7);
  let perDay = $derived(Math.round(data.stats.visits / range));
</script>

<h1>{data.greeting}</h1>
<ul>
  <li>visits: {data.stats.visits}</li>
  <li>signups: {data.stats.signups}</li>
  <li>errors: {data.stats.errors}</li>
</ul>
<label>
  Days: <input type="range" min="1" max="30" bind:value={range} />
  {range} → {perDay} visits/day
</label>

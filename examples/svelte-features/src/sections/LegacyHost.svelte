<script lang="ts">
  import LegacyCounter from '../components/LegacyCounter.svelte';

  let start = $state(3);
  let events = $state<string[]>([]);
</script>

<h2>Legacy-mode component (no runes)</h2>
<label>start <input type="number" bind:value={start} /></label>
<LegacyCounter {start} on:change={e => (events = [...events.slice(-4), `change: ${e.detail}`])}>
  <em>slot content from a runes parent</em>
  <span slot="footer">named slot</span>
</LegacyCounter>
<ul>
  {#each events as e, i (i)}<li>{e}</li>{/each}
</ul>

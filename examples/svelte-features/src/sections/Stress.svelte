<script lang="ts">
  import Row from '../components/Row.svelte';

  let on = $state(false);
  let count = $state(1000);
  let tick = $state(0);
  const rows = $derived(Array.from({ length: on ? count : 0 }, (_, i) => i));
</script>

<h2>Stress (Render profiler)</h2>
<label><input data-testid="stress-toggle" type="checkbox" bind:checked={on} /> render rows</label>
<input type="number" bind:value={count} min="0" max="5000" step="100" />
<button type="button" data-testid="stress-tick" onclick={() => tick++}
  >update every row (tick {tick})</button
>

<div class="grid">
  {#each rows as i (i)}
    <Row index={i} {tick} />
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
    font-size: 0.75rem;
  }
</style>

<script lang="ts">
  import { shared } from '../lib/state.svelte';

  let { label }: { label: string } = $props();
  let ticks = $state(0);
</script>

<div class="widget">
  <strong>Widget ({label})</strong>
  <button type="button" data-testid="widget-tick" onclick={() => ticks++}>ticks: {ticks}</button>
  <span>shared.clicks = {shared.clicks}</span>
</div>

<style>
  .widget {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    padding: 0.5rem;
    border: 1px dashed #888;
    background: #fff;
  }
</style>

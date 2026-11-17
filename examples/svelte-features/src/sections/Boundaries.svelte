<script lang="ts">
  import Bomb from '../components/Bomb.svelte';

  let armed = $state(false);
  let caught = $state(0);
</script>

<h2>&lt;svelte:boundary&gt;</h2>

<svelte:boundary onerror={() => caught++}>
  <Bomb bind:armed />

  {#snippet failed(error: unknown, reset: () => void)}
    <div class="failed" role="alert">
      failed snippet: {(error as Error).message}
      <button
        type="button"
        data-testid="boundary-reset"
        onclick={() => {
          armed = false;
          reset();
        }}>reset</button
      >
    </div>
  {/snippet}
</svelte:boundary>
<p>errors caught by the boundary: {caught}</p>

<style>
  .failed {
    padding: 0.5rem;
    background: #fee;
    border: 1px solid #f99;
  }
</style>

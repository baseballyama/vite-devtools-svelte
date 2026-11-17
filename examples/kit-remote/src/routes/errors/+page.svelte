<script lang="ts">
  import { getBroken, getTodo } from '#lib/todos.remote.ts';

  let missing = $state(999);
</script>

<h1>Failing queries</h1>

<h2>Thrown error → <code>failed</code> snippet</h2>
<svelte:boundary>
  <p>{await getBroken()}</p>
  {#snippet pending()}<p>loading…</p>{/snippet}
  {#snippet failed(error: unknown, reset: () => void)}
    <p class="failed" data-testid="failed">Failed: {(error as Error).message}</p>
    <button type="button" onclick={reset}>Retry</button>
  {/snippet}
</svelte:boundary>

<h2><code>error(404)</code> from a query</h2>
<svelte:boundary>
  <p>{(await getTodo(missing)).text}</p>
  {#snippet pending()}<p>loading…</p>{/snippet}
  {#snippet failed(error: unknown, reset: () => void)}
    <p class="failed">404: {(error as { message?: string }).message}</p>
    <button
      type="button"
      onclick={() => {
        missing = 1;
        reset();
      }}>Ask for #1 instead</button
    >
  {/snippet}
</svelte:boundary>

<h2>Reading <code>.error</code> without awaiting</h2>
{#snippet status()}
  {@const q = getBroken()}
  <p>loading: {q.loading} · error: {q.error?.message ?? '—'}</p>
{/snippet}
{@render status()}

<style>
  .failed {
    color: crimson;
  }
</style>

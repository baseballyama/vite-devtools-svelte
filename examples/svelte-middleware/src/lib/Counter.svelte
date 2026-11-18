<script lang="ts">
  let { initial }: { initial: number } = $props();

  // Starts from the server-provided prop; the server and the client agree.
  // svelte-ignore state_referenced_locally
  let count = $state(initial);
  let doubled = $derived(count * 2);
  let parity = $derived(count % 2 === 0 ? 'even' : 'odd');

  $effect(() => {
    document.title = `svelte-middleware (${count})`;
  });
</script>

<section>
  <h2>Counter</h2>
  <button type="button" data-testid="increment" onclick={() => count++}>count: {count}</button>
  <p>doubled: {doubled}</p>
  <p>parity: {parity}</p>
</section>

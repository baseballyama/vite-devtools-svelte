<script>
  import PerfRow from './PerfRow.svelte';

  let items = $state([{ id: 1 }, { id: 2 }, { id: 3 }]);
  let selected = $state(0);
  let count = $state(0);
  let doubled = $state(0);
  $effect(() => {
    // writes state while the update runs: a cascade, not its cause
    doubled = count * 2;
  });
  export function add() {
    items.push({ id: items.length + 1 });
  }
</script>

<button id="select" onclick={() => (selected += 1)}>select</button>
<button class="bump svelte-x1y2z3" onclick={() => count++}>{count} {doubled}</button>
{#each items as item (item.id)}
  <PerfRow {item} {selected} />
{/each}

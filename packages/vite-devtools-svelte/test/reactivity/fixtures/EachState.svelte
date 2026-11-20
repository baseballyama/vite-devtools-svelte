<script>
  import { Counter } from './counter.svelte.js';
  let items = $state([1, 2, 3]);
  export function removeFirst() {
    items.shift();
  }
</script>

{#each items as item (item)}
  {@const counter = new Counter()}
  <p>{item}: {counter.doubled}</p>
{/each}

<script>
  let n = 3;
  let items = $state([1, 2, 3]);
  export function replace() {
    items.shift();
    items.push(++n);
  }
</script>

{#each items as item (item)}
  {@const dbl = item * 2}
  <p>{dbl}</p>
{/each}

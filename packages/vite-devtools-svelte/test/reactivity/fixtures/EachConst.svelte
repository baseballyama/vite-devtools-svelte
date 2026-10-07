<script>
  let items = $state([1, 2, 3])
  export function add() {
    items.push(items.length + 1)
  }
  export function removeFirst() {
    items.shift()
  }
</script>

{#each items as item (item)}
  {@const dbl = item * 2}
  <p>{dbl}</p>
{/each}

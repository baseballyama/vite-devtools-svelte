<script>
  import { inventory } from './stock.svelte'
  let obj = $state({ n: 1 })
  const n = $derived(obj.n)
  export const api = { replace: () => (obj = { n: 2 }) }
</script>

<p>{inventory.items[0].name} {n} {inventory.total}</p>

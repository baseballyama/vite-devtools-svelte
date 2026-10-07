<script>
  import Price from './Price.svelte'
  import { cart, addToCart, getTotal } from './shared.svelte'
  const count = $derived(cart.items.length)
  const sum = $derived(getTotal())
  export const api = { add: () => addToCart({ price: 5 }) }
</script>

<p>{count} {sum}</p>
<Price amount={sum} />

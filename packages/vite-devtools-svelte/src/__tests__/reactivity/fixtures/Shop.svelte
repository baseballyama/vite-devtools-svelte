<script>
  import { cart, addToCart, getTotal } from './shared.svelte.js'
  import Price from './Price.svelte'
  const count = $derived(cart.items.length)
  const sum = $derived(getTotal())
  export const api = { add: () => addToCart({ price: 5 }) }
</script>

<p>{count} {sum}</p>
<Price amount={sum} />

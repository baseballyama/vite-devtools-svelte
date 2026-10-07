// module-level shared state (the Svelte 5 replacement for stores)
export const cart = $state({ items: [] })
export const settings = $state({ theme: 'light' })
let total = $state(0)
export function addToCart(item) {
  cart.items.push(item)
  total += item.price
}
export function getTotal() {
  return total
}

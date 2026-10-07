class Inventory {
  items = $state([{ name: 'a', qty: 1 }])
  total = $derived(this.items.reduce((s, i) => s + i.qty, 0))
  add() {
    this.items.push({ name: 'b', qty: 2 })
  }
}
export const inventory = new Inventory()

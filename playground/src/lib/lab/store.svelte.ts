// Shared state for the reactivity lab (/lab): a class-based store and a
// module-level $state object, both created while this module body runs.
export interface LabItem {
  id: number
  name: string
  qty: number
}

class Inventory {
  items = $state<LabItem[]>([])
  total = $derived(this.items.reduce((sum, item) => sum + item.qty, 0))
  #next = 1

  add(name: string) {
    this.items.push({ id: this.#next++, name, qty: 1 })
  }
}

export const inventory = new Inventory()
export const prefs = $state({ compact: false })

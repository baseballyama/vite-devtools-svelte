interface CartLine {
  id: string
  name: string
  price: number
  qty: number
}

function createCart() {
  let lines = $state<CartLine[]>([])
  const total = $derived(lines.reduce((s, l) => s + l.price * l.qty, 0))
  const itemCount = $derived(lines.reduce((s, l) => s + l.qty, 0))
  const uniqueCount = $derived(lines.length)

  return {
    get lines() {
      return lines
    },
    get total() {
      return total
    },
    get itemCount() {
      return itemCount
    },
    get uniqueCount() {
      return uniqueCount
    },
    add(item: { id: string; name: string; price: number }) {
      const existing = lines.find(l => l.id === item.id)
      if (existing) {
        existing.qty += 1
      } else {
        lines.push({ ...item, qty: 1 })
      }
    },
    remove(id: string) {
      lines = lines.filter(l => l.id !== id)
    },
    setQty(id: string, qty: number) {
      const line = lines.find(l => l.id === id)
      if (!line) return
      if (qty <= 0) {
        lines = lines.filter(l => l.id !== id)
      } else {
        line.qty = qty
      }
    },
    clear() {
      lines = []
    },
  }
}

export const cart = createCart()

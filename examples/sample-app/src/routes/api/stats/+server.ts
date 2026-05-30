import { json } from '@sveltejs/kit'
import { products } from '$lib/server/products'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const totalStock = products.reduce((s, p) => s + p.stock, 0)
  const totalValue = products.reduce((s, p) => s + p.stock * p.price, 0)
  const lowStockSku = products.filter((p) => p.stock <= 8).length

  return json({
    totalSku: products.length,
    totalStock,
    totalValue,
    lowStockSku,
    avgPrice: Math.round(
      products.reduce((s, p) => s + p.price, 0) / products.length,
    ),
  })
}

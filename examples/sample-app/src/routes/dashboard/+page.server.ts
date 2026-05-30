import { products } from '$lib/server/products'
import type { PageServerLoad } from './$types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const load: PageServerLoad = async () => {
  // 並列 load — Load Profiler のウォーターフォール確認
  const [stats, lowStock, byCategory] = await Promise.all([
    sleep(120).then(() => ({
      totalSku: products.length,
      totalStock: products.reduce((s, p) => s + p.stock, 0),
      avgPrice: Math.round(
        products.reduce((s, p) => s + p.price, 0) / products.length,
      ),
    })),
    sleep(200).then(() => products.filter((p) => p.stock <= 8)),
    sleep(160).then(() => {
      const map = new Map<string, number>()
      for (const p of products) {
        map.set(p.category, (map.get(p.category) ?? 0) + 1)
      }
      return [...map.entries()].map(([category, count]) => ({ category, count }))
    }),
  ])

  return { stats, lowStock, byCategory }
}

import { products } from '#lib/server/products.ts'

import type { RequestHandler } from './$types'

export const GET: RequestHandler = ({ url }) => {
  const category = url.searchParams.get('category')
  const items = category ? products.filter(p => p.category === category) : products
  return Response.json({ items, count: items.length })
}

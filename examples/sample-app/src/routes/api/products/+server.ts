import { json } from '@sveltejs/kit'
import { products } from '$lib/server/products'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const category = url.searchParams.get('category')
  const items = category ? products.filter(p => p.category === category) : products
  return json({ items, count: items.length })
}

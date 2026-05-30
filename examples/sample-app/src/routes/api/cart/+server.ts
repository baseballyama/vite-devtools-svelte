import { json, error } from '@sveltejs/kit'
import { getProduct } from '$lib/server/products'
import type { RequestHandler } from './$types'

interface AddRequest {
  productId: string
  qty?: number
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as AddRequest
  const product = getProduct(body.productId)
  if (!product) error(404, 'product not found')

  const qty = body.qty ?? 1
  if (qty > product.stock) error(409, 'insufficient stock')

  return json({
    ok: true,
    line: { id: product.id, name: product.name, price: product.price, qty },
  })
}

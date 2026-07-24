import { error } from '@sveltejs/kit'
import { getProduct, products } from '$lib/server/products'
import type { PageServerLoad } from './$types'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const load: PageServerLoad = async ({ params }) => {
  await sleep(220) // load 遅延を擬似的に再現
  const product = getProduct(params.id)
  if (!product) error(404, '商品が見つかりません')

  const related = products
    .filter(p => p.category === product.category && p.id !== product.id)
    .slice(0, 3)

  return { product, related }
}

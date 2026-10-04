import type { PageServerLoad } from './$types'

// Static, non-confidential data; the load is what the Load profiler and the
// routes analyzer should report for this one route.
export const load: PageServerLoad = async () => {
  return {
    products: [
      { id: 1, name: 'Keyboard', price: 49 },
      { id: 2, name: 'Mouse', price: 19 },
      { id: 3, name: 'Monitor', price: 189 },
    ],
  }
}

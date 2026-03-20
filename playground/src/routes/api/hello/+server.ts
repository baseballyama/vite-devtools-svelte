import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  return json({ message: 'Hello from the API!' })
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  return json({ message: `Hello, ${body.name || 'World'}!` })
}

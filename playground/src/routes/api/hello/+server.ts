import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => {
  return Response.json({ message: 'Hello from the API!' })
}

export const POST: RequestHandler = async ({ request }) => {
  const body: unknown = await request.json()
  const name =
    typeof body === 'object' &&
    body !== null &&
    'name' in body &&
    typeof body.name === 'string' &&
    body.name !== ''
      ? body.name
      : 'World'
  return Response.json({ message: `Hello, ${name}!` })
}

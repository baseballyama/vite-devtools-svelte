export async function GET() {
  return new Response(JSON.stringify({ message: 'hello' }))
}

export async function POST({ request }) {
  const body = await request.json()
  return new Response(JSON.stringify(body))
}

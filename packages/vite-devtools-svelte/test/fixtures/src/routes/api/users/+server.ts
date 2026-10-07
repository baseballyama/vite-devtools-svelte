export function GET() {
  return new Response(JSON.stringify([]))
}

export async function POST({ request }) {
  const body = await request.json()
  return new Response(JSON.stringify(body), { status: 201 })
}

export function DELETE({ params: _params }) {
  return new Response(null, { status: 204 })
}

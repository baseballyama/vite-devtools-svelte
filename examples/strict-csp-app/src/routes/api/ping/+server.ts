import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => Response.json({ ok: true, t: Date.now() })

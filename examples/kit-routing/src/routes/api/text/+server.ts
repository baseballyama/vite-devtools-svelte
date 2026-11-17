import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  new Response(`plain text from /api/text at ${new Date().toISOString()}`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

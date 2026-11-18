import type { RequestHandler } from './$types';

// `[x+2e]well-known` is the escaped form of `.well-known` (a directory can't start with `.`).
export const GET: RequestHandler = () =>
  Response.json({ route: '/.well-known', escaped: '[x+2e]well-known' });

import type { RequestHandler } from './$types';

// Endpoints keep their exact URL: no trailing slash here.
export const trailingSlash = 'never';

export const GET: RequestHandler = ({ url }) =>
  Response.json({ path: url.pathname, at: Date.now() });

export const POST: RequestHandler = async ({ request }) =>
  new Response(`echo: ${await request.text()}`);

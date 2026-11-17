import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleFetch, HandleServerError } from '@sveltejs/kit/hooks';

const requestId: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID().slice(0, 8);
  event.locals.startedAt = performance.now();
  return resolve(event);
};

const timing: Handle = async ({ event, resolve }) => {
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%request-id%', event.locals.requestId),
  });
  const ms = (performance.now() - event.locals.startedAt).toFixed(1);
  response.headers.set('server-timing', `handle;dur=${ms}`);
  response.headers.set('x-request-id', event.locals.requestId);
  return response;
};

export const handle = sequence(requestId, timing);

/** Server-side fetches to our own API carry a marker header (see /api/items GET). */
export const handleFetch: HandleFetch = async ({ request, fetch }) => {
  if (new URL(request.url).pathname.startsWith('/api/')) {
    request.headers.set('x-from-handle-fetch', '1');
  }
  return fetch(request);
};

// SvelteKit 3: `kind` tells app errors (error()), framework errors (404s) and unknown
// throws apart; status and message are inherited unless returned.
export const handleError: HandleServerError = ({ kind, error }) => {
  const errorId = crypto.randomUUID().slice(0, 8);
  if (kind === 'unknown') console.error(`[kit-routing] unexpected server error ${errorId}:`, error);
  return { errorId };
};

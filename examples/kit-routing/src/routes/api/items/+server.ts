import { error } from '@sveltejs/kit';

import { items } from '#lib/items.ts';

import type { RequestHandler } from './$types';

type Body = { id?: number; name?: string; done?: boolean };

function body(request: Request): Promise<Body> {
  return (request.json() as Promise<Body>).catch(() => error(400, 'Expected a JSON body'));
}

function find(id: number | undefined) {
  const item = items.find(i => i.id === id);
  if (!item) error(404, `Item ${id} not found`);
  return item;
}

export const GET: RequestHandler = ({ request, url }) => {
  const done = url.searchParams.get('done');
  const list = done === null ? items : items.filter(i => String(i.done) === done);
  return Response.json(list, {
    headers: { 'x-via-handle-fetch': request.headers.get('x-from-handle-fetch') ?? '0' },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const { name } = await body(request);
  if (!name) error(422, '`name` is required');
  const item = { id: Math.max(0, ...items.map(i => i.id)) + 1, name, done: false };
  items.push(item);
  return Response.json(item, { status: 201 });
};

export const PUT: RequestHandler = async ({ request }) => {
  const { id, name, done } = await body(request);
  const item = find(id);
  item.name = name ?? item.name;
  item.done = done ?? false;
  return Response.json(item);
};

export const PATCH: RequestHandler = async ({ request }) => {
  const { id, ...patch } = await body(request);
  return Response.json(Object.assign(find(id), patch));
};

export const DELETE: RequestHandler = ({ url }) => {
  const item = find(Number(url.searchParams.get('id')));
  items.splice(items.indexOf(item), 1);
  return new Response(null, { status: 204 });
};

export const OPTIONS: RequestHandler = () =>
  new Response(null, { headers: { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD' } });

// Any other method (e.g. QUERY, PROPFIND).
export const fallback: RequestHandler = ({ request }) =>
  text(`fallback handler got ${request.method}`);

function text(value: string) {
  return new Response(value, { headers: { 'content-type': 'text/plain' } });
}

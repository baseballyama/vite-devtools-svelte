import { command, form, getRequestEvent, prerender, query } from '$app/server';
import { error, invalid } from '@sveltejs/kit';

import * as db from '#lib/server/db.ts';

/** `query` without an argument. */
export const getTodos = query(async () => {
  await db.sleep(150);
  return db.todos.map(t => ({ ...t }));
});

/** `query` with an (unchecked) argument. */
export const getTodo = query('unchecked', async (id: number) => {
  await db.sleep(100);
  const todo = db.todos.find(t => t.id === id);
  if (!todo) error(404, `todo ${id} not found`);
  return { ...todo };
});

/** `query.batch`: every `getUser(id)` of one tick goes to the server in one request. */
export const getUser = query.batch('unchecked', async (ids: number[]) => {
  await db.sleep(120);
  const byId = new Map(db.users.filter(u => ids.includes(u.id)).map(u => [u.id, u]));
  return (id: number) => byId.get(id) ?? { id, name: '(unknown)' };
});

/** A query that always fails, shown through a `<svelte:boundary>` `failed` snippet. */
export const getBroken = query(async (): Promise<string> => {
  await db.sleep(80);
  throw new Error('getBroken always fails (on purpose)');
});

/** `getRequestEvent()` inside a remote function. */
export const getRequestInfo = query(() => {
  const event = getRequestEvent();
  return {
    userAgent: event.request.headers.get('user-agent')?.slice(0, 40) ?? '',
    // In a remote function `event.url` is not the page URL (reading it
    // throws remote_request_property); the route id is null there too.
    method: event.request.method,
    at: new Date().toISOString(),
  };
});

/** `prerender`: computed once at build time (and per request in dev). */
export const getBuildInfo = prerender(() => ({
  builtAt: new Date().toISOString(),
  todoCount: db.todos.length,
}));

/** `query.live`: a stream the client stays subscribed to. */
export const getClock = query.live(async function* () {
  for (let tick = 0; tick < 1000; tick++) {
    yield { tick, at: new Date().toLocaleTimeString() };
    // A live query yields one value per tick: waiting inside the loop is the point.
    // oxlint-disable-next-line no-await-in-loop
    await db.sleep(1000);
  }
});

/** `form` with server-side validation through `invalid(...)`. */
export const createTodo = form('unchecked', async (data: { text: string }, issue) => {
  const text = (data.text ?? '').trim();
  if (text.length < 3) invalid(issue.text('At least 3 characters'));
  await db.sleep(300);
  const todo = db.addTodo(text);
  // Single-flight mutation: the refreshed list rides along with the response.
  void getTodos().refresh();
  return { created: todo.id };
});

/** `command` the client calls with an optimistic `withOverride` update. */
export const toggleTodo = command('unchecked', async (id: number) => {
  await db.sleep(400);
  const todo = db.todos.find(t => t.id === id);
  if (!todo) error(404, `todo ${id} not found`);
  todo.done = !todo.done;
  void getTodos().refresh();
  return todo.done;
});

export const removeDone = command(async () => {
  await db.sleep(200);
  const before = db.todos.length;
  for (let i = db.todos.length - 1; i >= 0; i--) {
    if (db.todos[i].done) db.todos.splice(i, 1);
  }
  void getTodos().refresh();
  return before - db.todos.length;
});

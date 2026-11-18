import * as db from '#lib/server/db.ts';

import type { PageServerLoad } from './$types';

// A classic server load next to remote functions: the Load functions panel
// records this one; remote calls are not loads.
export const load: PageServerLoad = async () => {
  await db.sleep(120);
  return { count: db.todos.length, first: db.todos[0]?.text ?? null };
};

import { error } from '@sveltejs/kit';

import { fetchUsers } from '#lib/users.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
  const users = await fetchUsers(fetch);
  const user = users.find(u => String(u.id) === params.id);
  // Thrown loads are rethrown unchanged and not recorded by the profiler.
  if (!user) error(404, `No user with id ${params.id}`);
  const index = users.indexOf(user);
  return { user, next: users[(index + 1) % users.length] };
};

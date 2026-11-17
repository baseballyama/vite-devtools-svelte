import { fetchUsers } from '#lib/users.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
  const role = url.searchParams.get('role');
  const users = await fetchUsers(fetch);
  return { users: role ? users.filter(u => u.role === role) : users, role };
};

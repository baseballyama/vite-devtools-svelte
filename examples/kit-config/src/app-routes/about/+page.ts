import type { PageLoad } from './$types';

// Universal load (server first, then the browser on client navigation).
export const load: PageLoad = async ({ parent }) => {
  const { loadedAt } = await parent();
  return { since: loadedAt, where: typeof window === 'undefined' ? 'server' : 'browser' };
};

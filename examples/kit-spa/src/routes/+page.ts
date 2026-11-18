import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
  // Waits for the layout load first: the Load functions waterfall shows the
  // page load starting only after the layout one finished.
  const { site } = await parent();
  const res = await fetch('/data/stats.json');
  const stats = (await res.json()) as { visits: number; signups: number; errors: number };
  return { stats, greeting: `Welcome to ${site.name}` };
};

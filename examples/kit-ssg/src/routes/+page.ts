import type { PageLoad } from './$types';

// Universal load: at build time on the server, then again in the browser on
// client-side navigation back to `/`.
export const load: PageLoad = async ({ parent }) => {
  const { postCount } = await parent();
  return { greeting: `A static site with ${postCount} posts` };
};

import { posts } from '#lib/posts.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
  posts: posts.map(({ slug, title, date }) => ({ slug, title, date })),
});

import { posts } from '#lib/posts.ts';

import type { LayoutServerLoad } from './$types';

// Runs at build time only (prerendered); in dev it runs on every request.
export const load: LayoutServerLoad = () => ({
  siteName: 'kit-ssg',
  postCount: posts.length,
  renderedAt: new Date().toISOString(),
});

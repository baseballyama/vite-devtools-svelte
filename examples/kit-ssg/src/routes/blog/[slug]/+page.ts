import type { PageLoad } from './$types';

// Universal load on top of the server load: both run for this route.
export const load: PageLoad = ({ data }) => ({
  ...data,
  words: data.post.body.split(/\s+/).length,
});

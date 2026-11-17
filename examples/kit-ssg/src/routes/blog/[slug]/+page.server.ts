import { error } from '@sveltejs/kit';

import { findPost, posts } from '#lib/posts.ts';

import type { EntryGenerator, PageServerLoad } from './$types';

// Every slug to prerender (the crawler would find them too; this makes it explicit).
export const entries: EntryGenerator = () => posts.map(p => ({ slug: p.slug }));

export const load: PageServerLoad = ({ params }) => {
  const post = findPost(params.slug);
  if (!post) error(404, 'No such post');
  // The next post (wrapping): moving between posts keeps this page mounted.
  const next = posts[(posts.indexOf(post) + 1) % posts.length];
  return { post, next: { slug: next.slug, title: next.title } };
};

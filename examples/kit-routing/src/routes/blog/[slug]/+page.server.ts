import { error } from '@sveltejs/kit';

import { delay } from '#lib/delay.ts';

import type { PageServerLoad } from './$types';

const posts: Record<string, string> = {
  'hello-world': 'The first post.',
  'routing-deep-dive': 'Groups, resets, matchers and escapes.',
  streaming: 'Promises returned from server loads stream to the page.',
};

export const load: PageServerLoad = async ({ params }) => {
  await delay(80);
  const body = posts[params.slug];
  if (!body) error(404, `No post called "${params.slug}"`);
  return { slug: params.slug, body };
};

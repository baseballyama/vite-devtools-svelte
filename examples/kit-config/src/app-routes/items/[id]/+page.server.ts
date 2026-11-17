import { error } from '@sveltejs/kit';

import { items } from '#lib/items.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const item = items.find(i => i.id === params.id);
  if (!item) error(404, `No item ${params.id}`);
  return { item };
};

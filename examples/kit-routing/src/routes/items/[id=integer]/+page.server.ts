import { error } from '@sveltejs/kit';

import { items } from '#lib/items.ts';

import type { PageServerLoad } from './$types';

// `load` shares one `export const` with another export: the profiler wraps the load
// and re-exports `ssr` unchanged.
export const load: PageServerLoad = ({ params }) => {
    const item = items.find(i => i.id === params.id);
    if (!item) error(404, `Item ${params.id} not found`);
    return { item };
  },
  ssr = true;

import { products } from '#lib/server/products.ts';

import type { PageServerLoad } from './$types';

const sleep = (ms: number) =>
  new Promise(r => {
    setTimeout(r, ms);
  });

export const load: PageServerLoad = async ({ url }) => {
  const category = url.searchParams.get('category') ?? 'all';

  // Deliberate fake delay, so the load shows up in the Load profiler waterfall
  const [items, categories] = await Promise.all([
    sleep(180).then(() =>
      category === 'all' ? products : products.filter(p => p.category === category),
    ),
    sleep(80).then(() => ['all', ...new Set(products.map(p => p.category))]),
  ]);

  return { items, categories, category };
};

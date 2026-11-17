import { items } from '#lib/items.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 50);
  });
  return { items };
};

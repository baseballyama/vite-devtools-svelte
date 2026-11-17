import { delay } from '#lib/delay.ts';

import type { LayoutServerLoad } from './$types';

// 1/4 of the (app) chain: layout server load (runs in parallel with the page server load).
export const load: LayoutServerLoad = async ({ locals }) => {
  await delay(120);
  return { user: { name: 'Ada', role: 'admin' }, servedBy: locals.requestId };
};

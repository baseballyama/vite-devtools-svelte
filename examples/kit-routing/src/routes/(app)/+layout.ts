import { delay } from '#lib/delay.ts';

import type { LayoutLoad } from './$types';

// 2/4: universal layout load. Waits for its parent (sequential) and adds client-side
// data; on client navigation it runs in the browser and reports over the HMR channel.
export const load: LayoutLoad = async ({ data, parent }) => {
  await parent();
  await delay(60);
  return {
    ...data,
    sidebar: ['dashboard', 'settings', 'admin'],
    ranIn: typeof window === 'undefined' ? 'server' : 'browser',
  };
};

import { delay } from '#lib/delay.ts';

import type { PageLoad } from './$types';

// 4/4: universal page load, after its parents (sequential), merging the server data.
export const load: PageLoad = async ({ data, parent }) => {
  const { sidebar } = await parent();
  await delay(40);
  return { ...data, sections: sidebar.length, clientTime: new Date().toISOString() };
};

import { delay } from '#lib/delay.ts';
import { Money } from '#lib/money.ts';

import type { PageServerLoad } from './$types';

// 3/4: page server load. Runs in parallel with the layout server load, depends on a
// custom key (invalidate('app:clock')), streams a slow promise and returns a class
// instance that crosses to the browser through the `transport` hook.
export const load: PageServerLoad = async ({ depends, fetch }) => {
  depends('app:clock');
  const [itemsResponse] = await Promise.all([fetch('/api/items'), delay(150)]);
  const items = (await itemsResponse.json()) as { id: number; name: string }[];
  return {
    serverTime: new Date().toISOString(),
    revenue: new Money(1234567, 'EUR'),
    items,
    // Not awaited: the page renders first and the value streams in later.
    slowStats: delay(1500).then(() => ({ visitors: 4321, conversion: 0.034 })),
  };
};

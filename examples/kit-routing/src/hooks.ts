import type { Reroute, Transport } from '@sveltejs/kit/hooks';

import { Money } from '#lib/money.ts';

/** Old URLs keep working: /legacy-about renders the /about route (URL unchanged). */
export const reroute: Reroute = ({ url }) =>
  url.pathname === '/legacy-about' ? '/about' : url.pathname;

export const transport: Transport = {
  Money: {
    encode: value => value instanceof Money && [value.cents, value.currency],
    decode: ([cents, currency]: [number, string]) => new Money(cents, currency),
  },
};

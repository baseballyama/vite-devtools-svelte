import type { PageLoad } from './$types';

// An unexpected error: goes through handleError (server on SSR, client on navigation).
export const load: PageLoad = ({ url }) => {
  if (!url.searchParams.has('ok')) throw new Error('Unexpected failure in crash/+page.ts');
  return { ok: true };
};

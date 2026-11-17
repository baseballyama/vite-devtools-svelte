import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

// A load that throws redirect(): it is rethrown unchanged and not recorded by the profiler.
export const load: PageServerLoad = () => {
  redirect(307, '/about');
};

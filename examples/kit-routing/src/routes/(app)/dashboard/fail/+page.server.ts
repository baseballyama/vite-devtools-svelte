import { error } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  error(503, 'The dashboard widget backend is down');
};

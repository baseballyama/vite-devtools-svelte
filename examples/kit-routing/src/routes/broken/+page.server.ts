import { error } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

// An expected error: rendered by the root +error.svelte.
export const load: PageServerLoad = () => {
  error(418, "I'm a teapot");
};

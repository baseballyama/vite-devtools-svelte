import type { LayoutServerLoad } from './$types';

// Root server load: runs for every page, so each navigation shows it first in the waterfall.
export const load: LayoutServerLoad = ({ locals }) => ({ requestId: locals.requestId });

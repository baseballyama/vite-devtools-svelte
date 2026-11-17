import type { PageLoad } from './$types';

// Two params in one segment.
export const load: PageLoad = ({ params }) => ({ name: params.name, ext: params.ext });

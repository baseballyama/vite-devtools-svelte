import type { LayoutLoad } from './$types';

// Every URL ends in a slash: /base/ , /base/about/ , /base/items/1/
export const trailingSlash = 'always';

export const load: LayoutLoad = () => ({ loadedAt: new Date().toISOString() });

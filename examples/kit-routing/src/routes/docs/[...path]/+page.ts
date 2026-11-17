import type { PageLoad } from './$types';

// Declared, then exported with `export { load }`: the Load functions profiler only
// wraps `export const load` / `export function load`, so this load is NOT recorded.
const load: PageLoad = ({ params }) => ({ segments: params.path.split('/').filter(Boolean) });

export { load };

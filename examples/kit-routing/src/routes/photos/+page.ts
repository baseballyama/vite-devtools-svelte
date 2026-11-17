import { photos } from '#lib/photos.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = () => ({ photos });

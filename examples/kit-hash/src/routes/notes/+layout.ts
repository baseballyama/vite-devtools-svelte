import { listNotes } from '#lib/notes.ts';

import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async () => ({ notes: await listNotes() });

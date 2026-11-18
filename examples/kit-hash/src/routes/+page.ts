import { listNotes } from '#lib/notes.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const notes = await listNotes();
  return { count: notes.length };
};

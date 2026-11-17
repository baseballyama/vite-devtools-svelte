import { error } from '@sveltejs/kit';

import { getNote } from '#lib/notes.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent }) => {
  const { notes } = await parent();
  const note = await getNote(params.slug);
  if (!note) error(404, `No note "${params.slug}"`);
  const index = notes.findIndex(n => n.slug === note.slug);
  return { note, next: notes[(index + 1) % notes.length] };
};

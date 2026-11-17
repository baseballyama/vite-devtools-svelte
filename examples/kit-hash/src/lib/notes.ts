export interface Note {
  slug: string;
  title: string;
  body: string;
  tags: string[];
}

const NOTES: Note[] = [
  {
    slug: 'hash-router',
    title: 'Hash router',
    body: 'URLs look like /#/notes/hash-router; the server only ever sees /.',
    tags: ['routing'],
  },
  {
    slug: 'universal-load',
    title: 'Universal loads',
    body: 'With the hash router they run in the browser, after every hash change.',
    tags: ['load'],
  },
  {
    slug: 'nested-layouts',
    title: 'Nested layouts',
    body: 'The notes layout stays mounted while the page under it changes.',
    tags: ['routing', 'layout'],
  },
];

/** A fake API with a little latency, so loads show up in the waterfall. */
export async function listNotes(): Promise<Pick<Note, 'slug' | 'title'>[]> {
  await new Promise(resolve => {
    setTimeout(resolve, 40);
  });
  return NOTES.map(({ slug, title }) => ({ slug, title }));
}

export async function getNote(slug: string): Promise<Note | undefined> {
  await new Promise(resolve => {
    setTimeout(resolve, 60);
  });
  return NOTES.find(n => n.slug === slug);
}

export type Post = { slug: string; title: string; date: string; body: string };

export const posts: Post[] = [
  {
    slug: 'hello-ssg',
    title: 'Hello, prerendering',
    date: '2026-01-10',
    body: 'Every page of this site is HTML written at build time.',
  },
  {
    slug: 'hydration',
    title: 'Hydration after prerender',
    date: '2026-02-14',
    body: 'The prerendered HTML is hydrated, so components are live again in the browser.',
  },
  {
    slug: 'no-js',
    title: 'Pages without JavaScript',
    date: '2026-03-03',
    body: 'With csr = false a page ships no JavaScript at all, so no devtools runtime either.',
  },
];

export const findPost = (slug: string) => posts.find(p => p.slug === slug);

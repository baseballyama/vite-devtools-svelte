import { posts } from '#lib/posts.ts';

// A prerendered endpoint: written to build/feed.json at build time.
export const prerender = true;
export const trailingSlash = 'never';

export const GET = () =>
  Response.json({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'kit-ssg',
    items: posts.map(p => ({
      id: p.slug,
      url: `/blog/${p.slug}/`,
      title: p.title,
      date_published: p.date,
    })),
  });

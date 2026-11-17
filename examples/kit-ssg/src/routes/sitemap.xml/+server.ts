import { posts } from '#lib/posts.ts';

export const prerender = true;
export const trailingSlash = 'never';

export const GET = () => {
  const urls = ['/', '/blog/', ...posts.map(p => `/blog/${p.slug}/`), '/no-js/', '/client-only/'];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://example.com${u}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
};

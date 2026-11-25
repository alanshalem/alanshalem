import type { APIRoute } from 'astro';
import { getPosts, getTags, postPath, tagPath } from '../lib/posts.ts';
import { absoluteUrl } from '../lib/site.ts';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const tags = await getTags();

  const entries: Array<{ path: string; lastmod?: Date }> = [
    { path: '/', lastmod: posts[0]?.updatedAt },
    { path: '/articulos/', lastmod: posts[0]?.updatedAt },
    { path: '/temas/' },
    ...posts.map((post) => ({ path: postPath(post), lastmod: post.updatedAt })),
    ...tags.map(({ tag }) => ({ path: tagPath(tag) })),
  ];

  const urls = entries
    .map(
      ({ path, lastmod }) =>
        `  <url><loc>${absoluteUrl(path)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

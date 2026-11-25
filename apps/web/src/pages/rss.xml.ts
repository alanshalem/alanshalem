import type { APIRoute } from 'astro';
import { getPosts, postPath } from '../lib/posts.ts';
import { absoluteUrl, site } from '../lib/site.ts';

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** En un feed las URLs relativas no sirven (el lector no sabe de qué sitio son). */
const withAbsoluteUrls = (html: string): string => html.replace(/(href|src)="\/(?!\/)/g, `$1="${site.url}/`);

export const GET: APIRoute = async () => {
  const posts = (await getPosts()).slice(0, 20);

  const items = posts
    .map((post) => {
      const url = absoluteUrl(postPath(post));
      // `]]>` cerraría el CDATA antes de tiempo; el renderer ya escapa el texto, pero se defiende igual.
      const content = withAbsoluteUrls(post.html).replaceAll(']]>', ']]]]><![CDATA[>');
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${post.publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(post.description)}</description>
      <content:encoded><![CDATA[${content}]]></content:encoded>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${site.url}/</link>
    <description>${escapeXml(site.tagline)}</description>
    <language>${site.lang}</language>
    <atom:link href="${absoluteUrl('/rss.xml')}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};

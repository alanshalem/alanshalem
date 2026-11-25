import { hreflangLinks, paths, type Alternates, type Lang } from './i18n.ts';
import { postPath, type BlogPost } from './posts.ts';

/** XML del feed RSS y del sitemap. Puro: los endpoints de src/pages solo cargan datos y responden. */

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** En un feed las URLs relativas no sirven (el lector no sabe de qué sitio son). */
const withAbsoluteUrls = (html: string, baseUrl: string): string =>
  html.replace(/(href|src)="\/(?!\/)/g, `$1="${baseUrl}/`);

export interface RssInput {
  lang: Lang;
  title: string;
  description: string;
  /** Solo los del idioma del feed, más nuevos primero. */
  posts: readonly BlogPost[];
  /** Origen del sitio sin barra final. */
  baseUrl: string;
}

export function rssXml({ lang, title, description, posts, baseUrl }: RssInput): string {
  const items = posts
    .map((post) => {
      const url = `${baseUrl}${postPath(post)}`;
      // `]]>` cerraría el CDATA antes de tiempo; el renderer ya escapa el texto, pero se defiende igual.
      const content = withAbsoluteUrls(post.html, baseUrl).replaceAll(']]>', ']]]]><![CDATA[>');
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${baseUrl}${paths.home(lang)}</link>
    <description>${escapeXml(description)}</description>
    <language>${lang}</language>
    <atom:link href="${baseUrl}${paths.rss(lang)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

export interface SitemapEntry {
  path: string;
  lastmod?: Date | undefined;
  /** Versiones de la página en cada idioma; con todas presentes salen como <xhtml:link hreflang>. */
  alternates?: Alternates | undefined;
}

export function sitemapXml(entries: readonly SitemapEntry[], baseUrl: string): string {
  const urls = entries
    .map(({ path, lastmod, alternates = {} }) => {
      const links = hreflangLinks(alternates)
        .map(({ hreflang, href }) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${href}"/>`)
        .join('');
      return `  <url><loc>${baseUrl}${path}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}${links}</url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

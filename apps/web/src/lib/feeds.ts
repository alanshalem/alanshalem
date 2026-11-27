import { hreflangLinks, paths, ui, type Alternates, type Lang } from './i18n.ts';
import { postPath, type BlogPost } from './posts.ts';

/** XML of the RSS feed and the sitemap. Pure: the src/pages endpoints only load data and respond. */

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Relative URLs are useless in a feed (the reader does not know which site they belong to). */
const withAbsoluteUrls = (html: string, baseUrl: string): string =>
  html.replace(/(href|src)="\/(?!\/)/g, `$1="${baseUrl}/`);

export interface RssInput {
  lang: Lang;
  title: string;
  description: string;
  /** Only those in the feed's language, newest first. */
  posts: readonly BlogPost[];
  /** The site origin without a trailing slash. */
  baseUrl: string;
}

export function rssXml({ lang, title, description, posts, baseUrl }: RssInput): string {
  const items = posts
    .map((post) => {
      const url = `${baseUrl}${postPath(post)}`;
      // `]]>` would close the CDATA early; the renderer already escapes the text, but this defends anyway.
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
<?xml-stylesheet type="text/css" href="${paths.rssStyle(lang)}"?>
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

/** A one-line text as a CSS string (`content: "…"`): backslashes and quotes are escaped. */
const cssString = (text: string): string => `"${text.replace(/[\\"]/g, '\\$&')}"`;

/**
 * The feed's stylesheet (`<?xml-stylesheet type="text/css"?>`): opened in a browser it reads like a page of the site
 * (title, a notice of what it is, and per article title, date, summary and address) instead of the XML tree. CSS, not
 * XSLT: Chrome removed XSLT (since v155 it shows "uses XSLT, which the browser does not support"); CSS over XML works
 * everywhere. Feed readers ignore the instruction, so the feed stays just as valid. It starts from the site tokens
 * (`tokensCss`) to use the same colors and fonts; the texts come from the language's dictionary.
 */
export function rssStylesheet(lang: Lang, tokensCss: string): string {
  return `${tokensCss}

/* ---------- RSS feed in the browser (lib/feeds.ts) ---------- */
rss {
  display: block; max-width: calc(var(--prose-width) + 2 * var(--gutter)); margin: 0 auto;
  padding: var(--space-3-5) var(--gutter); font-family: var(--font-text); font-size: var(--text-body);
  line-height: var(--leading-body); color: var(--text-primary); background: var(--bg-page);
}
rss * { display: none; }
channel { display: block; }
channel::before {
  content: ${cssString(ui(lang).rssIntro)};
  display: block; margin-bottom: var(--space-2); padding: var(--space-1) var(--space-1-25);
  border: 1px solid var(--border-subtle); font-family: var(--font-ui); font-size: var(--text-ui); color: var(--text-secondary);
}
channel > title { display: block; font-size: var(--text-hero-h1); line-height: var(--leading-hero); }
channel > description { display: block; margin-top: var(--space-1); color: var(--text-secondary); }
item { display: block; padding: var(--space-1-25) 0; border-top: 1px solid var(--border-subtle); }
channel > description + item, channel > link + item { margin-top: var(--space-2); }
item > title, item > pubDate, item > description, item > link { display: block; }
item > title { font-family: var(--font-display); font-size: var(--text-title-sm); line-height: var(--leading-title); }
item > pubDate, item > link { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-tertiary); overflow-wrap: anywhere; }
item > description { margin-top: var(--space-0-25); color: var(--text-secondary); }
`;
}

export interface SitemapEntry {
  path: string;
  lastmod?: Date | undefined;
  /** The page's versions in each language; with all of them present they go out as <xhtml:link hreflang>. */
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

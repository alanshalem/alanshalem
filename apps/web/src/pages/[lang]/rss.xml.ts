import type { APIRoute } from 'astro';
import { rssXml } from '../../lib/feeds.ts';
import { LANGS, type Lang } from '../../lib/i18n.ts';
import { getPosts, postsIn } from '../../lib/posts.ts';
import { getSettings } from '../../lib/settings.ts';
import { site } from '../../lib/site.ts';

/** One feed per language (/es/rss.xml, /en/rss.xml): subscribers get the posts in the language they read. */
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang }, props: { lang } }));

const FEED_SIZE = 20;

export const GET: APIRoute<{ lang: Lang }> = async ({ props: { lang } }) => {
  const settings = await getSettings(lang);
  const xml = rssXml({
    lang,
    title: settings.name,
    description: settings.tagline,
    posts: postsIn(await getPosts(), lang).slice(0, FEED_SIZE),
    baseUrl: site.url,
  });
  // Only matters in `astro dev` (the build writes a file and Caddy picks the type from the .xml extension). With
  // application/rss+xml Chrome shows it as plain text and does not apply the stylesheet (rss.css); with an XML type,
  // as in production, it looks like on the published site. Feed readers accept both.
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

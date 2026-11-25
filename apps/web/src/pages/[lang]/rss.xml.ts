import type { APIRoute } from 'astro';
import { rssXml } from '../../lib/feeds.ts';
import { LANGS, type Lang } from '../../lib/i18n.ts';
import { getPosts, postsIn } from '../../lib/posts.ts';
import { getSettings } from '../../lib/settings.ts';
import { site } from '../../lib/site.ts';

/** Un feed por idioma (/es/rss.xml, /en/rss.xml): quien se suscribe recibe los posts en el idioma que lee. */
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
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};

import tokensCss from '@blog/tokens/tokens.css?raw';
import type { APIRoute } from 'astro';
import { rssStylesheet } from '../../lib/feeds.ts';
import { LANGS, type Lang } from '../../lib/i18n.ts';

/** Each feed's stylesheet (/es/rss.css, /en/rss.css): the notice is in the feed's language. See rssStylesheet. */
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang }, props: { lang } }));

export const GET: APIRoute<{ lang: Lang }> = ({ props: { lang } }) =>
  new Response(rssStylesheet(lang, tokensCss), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });

import tokensCss from '@blog/tokens/tokens.css?raw';
import type { APIRoute } from 'astro';
import { rssStylesheet } from '../../lib/feeds.ts';
import { LANGS, type Lang } from '../../lib/i18n.ts';

/** Hoja de estilo de cada feed (/es/rss.css, /en/rss.css): el aviso va en el idioma del feed. Ver rssStylesheet. */
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang }, props: { lang } }));

export const GET: APIRoute<{ lang: Lang }> = ({ props: { lang } }) =>
  new Response(rssStylesheet(lang, tokensCss), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });

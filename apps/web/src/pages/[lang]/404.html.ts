import type { APIRoute } from 'astro';
import { LANGS } from '../../lib/i18n.ts';

/*
 * /es/404.html and /en/404.html, which Caddy serves for anything missing under each prefix. It is the same page as
 * /404.html (pages/404.astro), rendered from this URL: it reads the original route and builds itself entirely in that
 * language. An endpoint and not an .astro page because Astro writes endpoints with their name as is; a
 * [lang]/404.astro page would come out as /es/404/index.html, one more URL answering 200, and duplicate the 404.
 */
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

export const GET: APIRoute = ({ rewrite }) => rewrite('/404');

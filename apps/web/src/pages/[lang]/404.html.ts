import type { APIRoute } from 'astro';
import { LANGS } from '../../lib/i18n.ts';

/*
 * /es/404.html y /en/404.html (L13), que Caddy sirve para lo que falte bajo cada prefijo. Es la misma página que
 * /404.html (pages/404.astro), renderizada desde esta URL: ella lee la ruta original y se arma entera en ese idioma.
 * Un endpoint y no una página .astro porque Astro escribe los endpoints con su nombre tal cual; una página
 * [lang]/404.astro saldría como /es/404/index.html, una URL más que respondería 200, y duplicaría el 404.
 */
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

export const GET: APIRoute = ({ rewrite }) => rewrite('/404');

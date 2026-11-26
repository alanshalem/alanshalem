import type { APIRoute } from 'astro';
import { robotsTxt } from '../lib/robots.ts';
import { site } from '../lib/site.ts';

/** /robots.txt con el sitemap del dominio de este despliegue (ver lib/robots.ts). */
export const GET: APIRoute = () =>
  new Response(robotsTxt(site.url), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

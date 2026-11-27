import type { APIRoute } from 'astro';
import { robotsTxt } from '../lib/robots.ts';
import { site } from '../lib/site.ts';

/** /robots.txt with the sitemap of this deployment's domain (see lib/robots.ts). */
export const GET: APIRoute = () =>
  new Response(robotsTxt(site.url), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

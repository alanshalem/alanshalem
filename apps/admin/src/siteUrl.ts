/**
 * Root of the public site, for the "Ver sitio" and "Volver al sitio" links.
 * In production Caddy serves the site and the admin on the same domain, so it is "/". In development the site runs on
 * another server (Astro): vite.config.ts injects its URL only in `vite dev`. Without Vite (tests) it is "/" too.
 */
export const SITE_URL: string = import.meta.env?.VITE_SITE_URL ?? '/';

/**
 * robots.txt (perfil-skills-produccion L8, P1-4): se rastrea el sitio, no el panel ni la API, y el sitemap apunta al
 * dominio del despliegue (`site` de astro.config.mjs, desde SITE_URL). Puro: src/pages/robots.txt.ts solo responde.
 */
export const robotsTxt = (siteUrl: string): string =>
  ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');

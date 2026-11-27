/**
 * robots.txt: crawlers index the site, not the admin or the API, and the sitemap points to the deployment's domain
 * (`site` in astro.config.mjs, from SITE_URL). Pure: src/pages/robots.txt.ts only responds.
 */
export const robotsTxt = (siteUrl: string): string =>
  ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');

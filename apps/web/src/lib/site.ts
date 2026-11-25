/**
 * Datos fijos del sitio. Nombre, bajada, bio y links del autor vienen de los ajustes del admin (lib/settings.ts);
 * SITE_NAME / SITE_TAGLINE / SITE_AUTHOR quedan solo como respaldo cuando la API los trae vacíos.
 */
export const site = {
  lang: 'es',
  locale: 'es-AR',
  url: (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, ''),
  nav: [
    { label: 'Artículos', href: '/articulos/' },
    { label: 'Temas', href: '/temas/' },
    { label: 'RSS', href: '/rss.xml' },
  ],
} as const;

/** URL absoluta a partir de una ruta del sitio ("/articulos/" -> "https://mi-sitio.com/articulos/"). */
export const absoluteUrl = (path: string): string => `${site.url}${path}`;

const dateFormatter = new Intl.DateTimeFormat(site.locale, {
  dateStyle: 'long',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export const formatDate = (date: Date): string => dateFormatter.format(date);

/** Año en la zona del sitio (para agrupar el archivo sin desfasajes de UTC). */
export const yearOf = (date: Date): number =>
  Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(date));

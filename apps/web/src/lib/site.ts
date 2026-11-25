/**
 * Datos fijos del sitio. Nombre, bajada, bio y links del autor vienen de los ajustes del admin (lib/settings.ts);
 * SITE_NAME / SITE_TAGLINE / SITE_AUTHOR quedan solo como respaldo cuando la API los trae vacíos.
 * Lo que depende del idioma (rutas, textos, fechas) está en lib/i18n.ts.
 */
export const site = {
  url: (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, ''),
} as const;

/** Zona del autor: fechas y años se muestran en ella en los dos idiomas (no en UTC ni en la del servidor de build). */
export const SITE_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** URL absoluta a partir de una ruta del sitio ("/es/articulos/" -> "https://mi-sitio.com/es/articulos/"). */
export const absoluteUrl = (path: string): string => `${site.url}${path}`;

/** Año en la zona del sitio (para agrupar el archivo sin desfasajes de UTC). */
export const yearOf = (date: Date): number =>
  Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: SITE_TIME_ZONE }).format(date));

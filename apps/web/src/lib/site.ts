/**
 * Datos fijos del sitio. Nombre, bajada, bio y links del autor vienen de los ajustes del admin (lib/settings.ts).
 * Lo que depende del idioma (rutas, textos, fechas) está en lib/i18n.ts.
 */
export const site = {
  // La URL la define `site` en astro.config.mjs (desde SITE_URL, con su valor por defecto): Astro la expone como
  // import.meta.env.SITE y acá solo se lee, para que no haya dos cálculos que puedan diferir (principio 5, L4).
  // Fuera de Astro (tests de Node) no hay `env`: vacía, y absoluteUrl devuelve la ruta tal cual.
  url: (import.meta.env?.SITE ?? '').replace(/\/$/, ''),
} as const;

/** Zona del autor: fechas y años se muestran en ella en los dos idiomas (no en UTC ni en la del servidor de build). */
export const SITE_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** URL absoluta a partir de una ruta del sitio ("/es/articulos/" -> "https://mi-sitio.com/es/articulos/"). */
export const absoluteUrl = (path: string): string => `${site.url}${path}`;

// Built once, like the date formatters of lib/i18n.ts: Intl.DateTimeFormat is costly and the archive calls it per post.
const YEAR_FORMAT = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: SITE_TIME_ZONE });

/** Año en la zona del sitio (para agrupar el archivo sin desfasajes de UTC). */
export const yearOf = (date: Date): number => Number(YEAR_FORMAT.format(date));

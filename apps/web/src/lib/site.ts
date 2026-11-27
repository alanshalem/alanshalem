/**
 * Fixed site data. The author's name, tagline, bio and links come from the admin settings (lib/settings.ts).
 * Whatever depends on the language (routes, texts, dates) lives in lib/i18n.ts.
 */
export const site = {
  // `site` in astro.config.mjs defines the URL (from SITE_URL, with its default): Astro exposes it as
  // import.meta.env.SITE and here it is only read, so there are not two computations that could differ.
  // Outside Astro (Node tests) there is no `env`: empty, and absoluteUrl returns the path as is.
  url: (import.meta.env?.SITE ?? '').replace(/\/$/, ''),
} as const;

/** The author's time zone: dates and years show in it in both languages (not in UTC nor in the build server's). */
export const SITE_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Absolute URL from a site path ("/es/articulos/" -> "https://my-site.com/es/articulos/"). */
export const absoluteUrl = (path: string): string => `${site.url}${path}`;

// Built once, like the date formatters of lib/i18n.ts: Intl.DateTimeFormat is costly and the archive calls it per post.
const YEAR_FORMAT = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: SITE_TIME_ZONE });

/** The year in the site time zone (to group the archive without UTC offsets). */
export const yearOf = (date: Date): number => Number(YEAR_FORMAT.format(date));

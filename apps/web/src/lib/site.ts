/** Datos del sitio. Se editan acá (o por variables de entorno en el build). */
export const site = {
  name: process.env.SITE_NAME ?? 'Mi blog',
  tagline: process.env.SITE_TAGLINE ?? 'Notas sobre software, ideas y cosas que estoy aprendiendo.',
  author: process.env.SITE_AUTHOR ?? 'El autor',
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

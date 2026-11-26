import { SITE_TIME_ZONE } from './site.ts';

/**
 * Única fuente de verdad del idioma en el sitio (L3): idiomas, rutas localizadas, textos de interfaz y fechas.
 * Dos idiomas fijos: un objeto por idioma es más simple que una librería de i18n o un esquema genérico (KISS/YAGNI).
 * Todo es puro: las páginas solo eligen el idioma y renderizan.
 */
export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
/** Idioma principal: x-default de hreflang y destino de la raíz `/` sin regla de Caddy. */
export const DEFAULT_LANG: Lang = 'es';

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

/** Nombre de cada idioma en su propio idioma (no se traduce: "English" se lee igual desde /es/). */
export const LANGUAGE_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };

interface LocaleData {
  /** Para Intl (fechas). */
  intl: string;
  /** Segmentos de URL traducidos (S4): /es/articulos/ ↔ /en/articles/. */
  segments: { posts: string; topics: string };
}

const LOCALES: Record<Lang, LocaleData> = {
  es: { intl: 'es-AR', segments: { posts: 'articulos', topics: 'temas' } },
  en: { intl: 'en-US', segments: { posts: 'articles', topics: 'topics' } },
};

/** Segmentos traducidos de un idioma: los `getStaticPaths` de las páginas los usan como parámetro de la ruta. */
export const segments = (lang: Lang): LocaleData['segments'] => LOCALES[lang].segments;

/** og:locale ("es_AR"): el formato de Open Graph usa guion bajo. */
export const ogLocale = (lang: Lang): string => LOCALES[lang].intl.replace('-', '_');

/** Rutas públicas por idioma, con barra final (trailingSlash: 'always'). Ninguna página arma URLs a mano. */
export const paths = {
  home: (lang: Lang): string => `/${lang}/`,
  posts: (lang: Lang): string => `/${lang}/${segments(lang).posts}/`,
  post: (lang: Lang, slug: string): string => `/${lang}/${segments(lang).posts}/${slug}/`,
  tags: (lang: Lang): string => `/${lang}/${segments(lang).topics}/`,
  tag: (lang: Lang, tagSlug: string): string => `/${lang}/${segments(lang).topics}/${tagSlug}/`,
  rss: (lang: Lang): string => `/${lang}/rss.xml`,
  /** Hoja de estilo del feed: lo hace legible al abrirlo en el navegador (lib/feeds.ts). */
  rssStyle: (lang: Lang): string => `/${lang}/rss.css`,
  /** Página 404 del idioma (L13): un archivo, no una URL del sitio. Caddy la sirve para lo que falte bajo /<lang>/. */
  notFound: (lang: Lang): string => `/${lang}/404.html`,
};

/** 404 de las URLs sin prefijo de idioma (bilingüe). Astro la escribe así por ser la página de estado de la raíz. */
export const NOT_FOUND_PATH = '/404.html';

/** Idioma de una ruta por su primer segmento ("/en/…" → en); sin prefijo de idioma, ninguno. */
export const langOfPath = (pathname: string): Lang | undefined => {
  const first = pathname.split('/')[1];
  return isLang(first) ? first : undefined;
};

/**
 * Qué muestra la página 404 según la URL desde la que se generó (L13): bajo /<lang>/, todo en ese idioma; si no
 * (/404.html, que Caddy usa para cualquier URL sin prefijo), cabecera y pie en el idioma principal y el aviso en los
 * dos, porque no se sabe en qué idioma lee quien llegó.
 */
export function notFoundPage(originPathname: string): { lang: Lang; notices: Lang[] } {
  const lang = langOfPath(originPathname);
  return lang ? { lang, notices: [lang] } : { lang: DEFAULT_LANG, notices: [...LANGS] };
}

/** La página equivalente en cada idioma que la tiene (la propia incluida). Alimenta hreflang y el selector. */
export type Alternates = Partial<Record<Lang, string>>;

/** Páginas que existen en todos los idiomas (home, listados): misma ruta en cada uno. */
export const alternatesFor = (path: (lang: Lang) => string): Alternates =>
  Object.fromEntries(LANGS.map((lang) => [lang, path(lang)]));

export interface LanguageLink {
  lang: Lang;
  href: string;
  current: boolean;
}

/**
 * Selector ES | EN (L3): la versión equivalente si existe; si no, `fallback` del otro idioma (la home, o el índice
 * de temas desde un tema: los temas no se traducen uno a uno).
 */
export const switcherLinks = (
  current: Lang,
  alternates: Alternates,
  fallback: (lang: Lang) => string = paths.home,
): LanguageLink[] => LANGS.map((lang) => ({ lang, href: alternates[lang] ?? fallback(lang), current: lang === current }));

/**
 * <link rel="alternate" hreflang> (y su par en el sitemap): solo si la página existe en todos los idiomas;
 * una página sin traducción no tiene alternativa que anunciar. x-default apunta al idioma principal.
 */
export function hreflangLinks(alternates: Alternates): Array<{ hreflang: string; href: string }> {
  const links = LANGS.flatMap((lang) => {
    const href = alternates[lang];
    return href ? [{ hreflang: lang, href }] : [];
  });
  const fallback = alternates[DEFAULT_LANG];
  if (links.length < LANGS.length || !fallback) return [];
  return [...links, { hreflang: 'x-default', href: fallback }];
}

// ---------- Textos de interfaz ----------
// `es` define las claves; `en` tiene que tener exactamente las mismas (el tipo lo exige y test/i18n.test.ts también
// revisa que ninguna quede vacía). `{n}` y `{tag}` se completan con `interpolate`.

const es = {
  skipToContent: 'Saltar al contenido',
  menu: 'Menú',
  mainNav: 'Principal',
  languageNav: 'Idioma',
  posts: 'Artículos',
  topics: 'Temas',
  rss: 'RSS',
  // Nombre accesible del enlace RSS: empieza con el texto visible (WCAG 2.5.3) y dice qué es.
  rssLabel: 'RSS: feed de artículos nuevos',
  // Lo que se lee arriba del feed abierto en el navegador (lib/feeds.ts, rssStylesheet).
  rssIntro: 'Esto es un feed RSS: copiá la dirección de esta página en tu lector de feeds para recibir los artículos nuevos.',
  home: 'Inicio',
  contact: 'Contacto',
  explore: 'Explorar',
  subscribe: 'Suscribirse',
  article: 'Artículo',
  articleCountOne: '1 artículo',
  articleCountMany: '{n} artículos',
  minutes: '{n} min',
  readingTime: '{n} min de lectura',
  heroLatest: 'Últimos artículos',
  // Botón del video del hero (WCAG 2.2.2): el ícono va aparte (aria-hidden), acá solo el nombre accesible.
  heroPlay: 'Reproducir',
  heroPause: 'Pausar',
  latest: 'Últimos',
  allPosts: 'Todos los artículos',
  morePosts: 'Más artículos',
  fullArchive: 'Archivo completo',
  allTopics: 'Todos los temas',
  noPosts: 'Todavía no hay artículos publicados.',
  noTopics: 'Todavía no hay temas.',
  postsDescription: 'Todos los artículos, por año.',
  postsDek: 'Todo lo publicado, del más nuevo al más viejo',
  postsArchive: 'Archivo por año',
  topicsDescription: 'Los artículos agrupados por tema.',
  topicsDek: 'Los artículos agrupados por tema. El número indica cuántos hay en cada uno.',
  topicsList: 'Lista de temas',
  postsAbout: 'Artículos sobre {tag}',
  aboutImage: 'Sobre la imagen',
  tocNav: 'Índice del artículo',
  tocLabel: 'En esta página',
  readNext: 'Seguir leyendo',
  notFoundTitle: 'Página no encontrada',
  notFoundEyebrow: 'Error 404',
  notFoundHeading: 'Esta página no existe.',
  notFoundDek: 'Puede que la dirección esté mal escrita o que el artículo haya cambiado de lugar.',
  backHome: 'Volver al inicio',
  // Respaldos visibles cuando ni los ajustes ni SITE_NAME / SITE_TAGLINE / SITE_AUTHOR traen texto (lib/settings.ts).
  defaultName: 'Mi blog',
  defaultTagline: 'Notas sobre software, ideas y cosas que estoy aprendiendo.',
  defaultAuthor: 'El autor',
};

export type UiKey = keyof typeof es;

const en: Record<UiKey, string> = {
  skipToContent: 'Skip to content',
  menu: 'Menu',
  mainNav: 'Main',
  languageNav: 'Language',
  posts: 'Articles',
  topics: 'Topics',
  rss: 'RSS',
  rssLabel: 'RSS: feed of new articles',
  rssIntro: "This is an RSS feed: copy this page's address into your feed reader to get new articles.",
  home: 'Home',
  contact: 'Contact',
  explore: 'Explore',
  subscribe: 'Subscribe',
  article: 'Article',
  articleCountOne: '1 article',
  articleCountMany: '{n} articles',
  minutes: '{n} min',
  readingTime: '{n} min read',
  heroLatest: 'Latest articles',
  heroPlay: 'Play',
  heroPause: 'Pause',
  latest: 'Latest',
  allPosts: 'All articles',
  morePosts: 'More articles',
  fullArchive: 'Full archive',
  allTopics: 'All topics',
  noPosts: 'No articles published yet.',
  noTopics: 'No topics yet.',
  postsDescription: 'All articles, by year.',
  postsDek: 'Everything published, newest first',
  postsArchive: 'Archive by year',
  topicsDescription: 'Articles grouped by topic.',
  topicsDek: 'Articles grouped by topic. The number shows how many each one has.',
  topicsList: 'Topic list',
  postsAbout: 'Articles about {tag}',
  aboutImage: 'About the image',
  tocNav: 'Table of contents',
  tocLabel: 'On this page',
  readNext: 'Keep reading',
  notFoundTitle: 'Page not found',
  notFoundEyebrow: 'Error 404',
  notFoundHeading: 'This page does not exist.',
  notFoundDek: 'The address may be misspelled, or the article may have moved.',
  backHome: 'Back to home',
  defaultName: 'My blog',
  defaultTagline: 'Notes on software, ideas and things I am learning.',
  defaultAuthor: 'The author',
};

const DICTIONARY: Record<Lang, Record<UiKey, string>> = { es, en };

/** Textos de interfaz de un idioma. */
export const ui = (lang: Lang): Readonly<Record<UiKey, string>> => DICTIONARY[lang];

/** Completa `{clave}` con los valores dados; una clave sin valor queda tal cual (se nota en la página). */
export const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

/** "1 artículo" / "3 artículos". Los dos idiomas solo distinguen uno de varios: no hace falta Intl.PluralRules. */
export const articleCount = (lang: Lang, n: number): string =>
  n === 1 ? ui(lang).articleCountOne : interpolate(ui(lang).articleCountMany, { n });

export interface NavLink {
  label: string;
  href: string;
  /** Solo si el texto visible no alcanza para saber adónde lleva ("RSS"). */
  ariaLabel?: string;
}

/** Menú principal del idioma (cabecera y pie). */
export const navLinks = (lang: Lang): NavLink[] => [
  { label: ui(lang).posts, href: paths.posts(lang) },
  { label: ui(lang).topics, href: paths.tags(lang) },
  { label: ui(lang).rss, href: paths.rss(lang), ariaLabel: ui(lang).rssLabel },
];

/**
 * `aria-current` de un enlace del menú: "page" solo en la página del enlace; dentro de su sección (un artículo bajo
 * Artículos, un tema bajo Temas) "true", que marca la sección sin decir que es esta página (P3, L4).
 */
export function navCurrent(currentPath: string, href: string): 'page' | 'true' | undefined {
  if (currentPath === href) return 'page';
  return currentPath.startsWith(href) ? 'true' : undefined;
}

// Un formateador por idioma, creado una vez: Intl.DateTimeFormat es caro de construir y se usa en cada tarjeta.
const DATE_FORMATTERS = Object.fromEntries(
  LANGS.map((lang) => [lang, new Intl.DateTimeFormat(LOCALES[lang].intl, { dateStyle: 'long', timeZone: SITE_TIME_ZONE })]),
) as Record<Lang, Intl.DateTimeFormat>;

export const formatDate = (lang: Lang, date: Date): string => DATE_FORMATTERS[lang].format(date);

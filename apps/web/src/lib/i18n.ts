import { SITE_TIME_ZONE } from './site.ts';

/**
 * The single source of truth for language on the site: languages, localized routes, UI texts and dates.
 * Two fixed languages: one object per language is simpler than an i18n library or a generic scheme (KISS/YAGNI).
 * Everything is pure: pages only pick the language and render.
 */
export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
/** Main language: the hreflang x-default and where the root `/` goes when there is no Caddy rule. */
export const DEFAULT_LANG: Lang = 'es';

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

/** Each language's name in that language (not translated: "English" reads the same from /es/). */
export const LANGUAGE_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };

interface LocaleData {
  /** For Intl (dates). */
  intl: string;
  /** Translated URL segments: /es/articulos/ ↔ /en/articles/. */
  segments: { posts: string; topics: string };
}

const LOCALES: Record<Lang, LocaleData> = {
  es: { intl: 'es-AR', segments: { posts: 'articulos', topics: 'temas' } },
  en: { intl: 'en-US', segments: { posts: 'articles', topics: 'topics' } },
};

/** A language's translated segments: the pages' `getStaticPaths` use them as route parameters. */
export const segments = (lang: Lang): LocaleData['segments'] => LOCALES[lang].segments;

/** og:locale ("es_AR"): the Open Graph format uses an underscore. */
export const ogLocale = (lang: Lang): string => LOCALES[lang].intl.replace('-', '_');

/** Public routes per language, with a trailing slash (trailingSlash: 'always'). No page builds URLs by hand. */
export const paths = {
  home: (lang: Lang): string => `/${lang}/`,
  posts: (lang: Lang): string => `/${lang}/${segments(lang).posts}/`,
  post: (lang: Lang, slug: string): string => `/${lang}/${segments(lang).posts}/${slug}/`,
  tags: (lang: Lang): string => `/${lang}/${segments(lang).topics}/`,
  tag: (lang: Lang, tagSlug: string): string => `/${lang}/${segments(lang).topics}/${tagSlug}/`,
  rss: (lang: Lang): string => `/${lang}/rss.xml`,
  /** The feed's stylesheet: makes it readable when opened in a browser (lib/feeds.ts). */
  rssStyle: (lang: Lang): string => `/${lang}/rss.css`,
  /** The language's 404 page: a file, not a site URL. Caddy serves it for anything missing under /<lang>/. */
  notFound: (lang: Lang): string => `/${lang}/404.html`,
};

/** The bilingual 404 for URLs without a language prefix. Astro writes it like this: it is the root's status page. */
export const NOT_FOUND_PATH = '/404.html';

/** A route's language from its first segment ("/en/…" → en); none without a language prefix. */
export const langOfPath = (pathname: string): Lang | undefined => {
  const first = pathname.split('/')[1];
  return isLang(first) ? first : undefined;
};

/**
 * What the 404 page shows depending on the URL it was generated from: under /<lang>/, everything in that language;
 * otherwise (/404.html, which Caddy uses for any URL without a prefix), header and footer in the main language and the
 * notice in both, because there is no telling which language the visitor reads.
 */
export function notFoundPage(originPathname: string): { lang: Lang; notices: Lang[] } {
  const lang = langOfPath(originPathname);
  return lang ? { lang, notices: [lang] } : { lang: DEFAULT_LANG, notices: [...LANGS] };
}

/** The equivalent page in each language that has it (the page itself included). Feeds hreflang and the switcher. */
export type Alternates = Partial<Record<Lang, string>>;

/** Pages that exist in every language (home, listings): the same route in each. */
export const alternatesFor = (path: (lang: Lang) => string): Alternates =>
  Object.fromEntries(LANGS.map((lang) => [lang, path(lang)]));

export interface LanguageLink {
  lang: Lang;
  href: string;
  current: boolean;
}

/**
 * ES | EN switcher: the equivalent version if it exists; otherwise the other language's `fallback` (the home, or the
 * topics index from a topic: topics are not translated one to one).
 */
export const switcherLinks = (
  current: Lang,
  alternates: Alternates,
  fallback: (lang: Lang) => string = paths.home,
): LanguageLink[] => LANGS.map((lang) => ({ lang, href: alternates[lang] ?? fallback(lang), current: lang === current }));

/**
 * <link rel="alternate" hreflang> (and its sitemap counterpart): only when the page exists in every language;
 * an untranslated page has no alternate to announce. x-default points to the main language.
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

// ---------- UI texts ----------
// `es` defines the keys; `en` must have exactly the same ones (the type requires it, and test/i18n.test.ts also
// checks that none is empty). `{n}` and `{tag}` are filled in by `interpolate`.

const es = {
  skipToContent: 'Saltar al contenido',
  menu: 'Menú',
  mainNav: 'Principal',
  languageNav: 'Idioma',
  posts: 'Artículos',
  topics: 'Temas',
  rss: 'RSS',
  // Accessible name of the RSS link: starts with the visible text (WCAG 2.5.3) and says what it is.
  rssLabel: 'RSS: feed de artículos nuevos',
  // What reads above the feed when opened in a browser (lib/feeds.ts, rssStylesheet).
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
  // Hero video button (WCAG 2.2.2): the icon goes separately (aria-hidden); here only the accessible name.
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
  // Fallback tagline when the settings have none (the only field the API may send empty; lib/settings.ts).
  defaultTagline: 'Notas sobre software, ideas y cosas que estoy aprendiendo.',
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
  defaultTagline: 'Notes on software, ideas and things I am learning.',
};

const DICTIONARY: Record<Lang, Record<UiKey, string>> = { es, en };

/** A language's UI texts. */
export const ui = (lang: Lang): Readonly<Record<UiKey, string>> => DICTIONARY[lang];

/** Fills `{key}` with the given values; a key without a value stays as is (it shows on the page). */
export const interpolate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

/** "1 artículo" / "3 artículos". Both languages only tell one from many: no need for Intl.PluralRules. */
export const articleCount = (lang: Lang, n: number): string =>
  n === 1 ? ui(lang).articleCountOne : interpolate(ui(lang).articleCountMany, { n });

export interface NavLink {
  label: string;
  href: string;
  /** Only when the visible text is not enough to tell where it leads ("RSS"). */
  ariaLabel?: string;
}

/** The language's main menu (header and footer). */
export const navLinks = (lang: Lang): NavLink[] => [
  { label: ui(lang).posts, href: paths.posts(lang) },
  { label: ui(lang).topics, href: paths.tags(lang) },
  { label: ui(lang).rss, href: paths.rss(lang), ariaLabel: ui(lang).rssLabel },
];

/**
 * `aria-current` of a menu link: "page" only on the link's own page; inside its section (an article under Articles,
 * a topic under Topics) "true", which marks the section without saying it is this page.
 */
export function navCurrent(currentPath: string, href: string): 'page' | 'true' | undefined {
  if (currentPath === href) return 'page';
  return currentPath.startsWith(href) ? 'true' : undefined;
}

// One formatter per language, built once: Intl.DateTimeFormat is costly to build and every card uses it.
const DATE_FORMATTERS = Object.fromEntries(
  LANGS.map((lang) => [lang, new Intl.DateTimeFormat(LOCALES[lang].intl, { dateStyle: 'long', timeZone: SITE_TIME_ZONE })]),
) as Record<Lang, Intl.DateTimeFormat>;

export const formatDate = (lang: Lang, date: Date): string => DATE_FORMATTERS[lang].format(date);

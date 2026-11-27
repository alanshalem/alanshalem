import { excerpt, sanitizeUrl, slugify, unescapeHtml } from '@blog/markdown';
import type { SiteSettings } from '../api/types.ts';
import type { Lang } from '../languages.ts';

/*
 * How search engines and social networks see the post. It is the same derivation the site does when publishing
 * (apps/web: BaseLayout.astro for <title> and og:*, lib/posts.ts for the description, lib/cover.ts for og:image);
 * the admin cannot import code from another app, so it is copied here and the tests pin it.
 */

/** Length of the meta description: the site uses `excerpt(body, 160)` when the post has no summary. */
export const META_DESCRIPTION_MAX = 160;
/** How much of a title Google usually shows before cutting it with "…". */
export const SEO_TITLE_MAX = 60;

const POST_SEGMENT: Record<Lang, string> = { es: 'articulos', en: 'articles' };

/** Public path of a post (apps/web/src/lib/i18n.ts, `paths.post`). */
export const postPath = (lang: Lang, slug: string): string => `/${lang}/${POST_SEGMENT[lang]}/${slug}/`;

/** Cuts at the last space before `max` and adds "…" (what search engines do with what does not fit). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : text.slice(0, max)).trimEnd()}…`;
}

/** The site name is a single field for both languages (apps/web/src/lib/settings.ts). */
export function siteNameFor(settings: Pick<SiteSettings, 'name'>): string {
  return settings.name.trim();
}

export interface ShareInput {
  title: string;
  summary: string;
  body: string;
  /** The already rendered body (renderPreview): the first image comes from it, as on the site. */
  html: string;
  /** Empty = the API generates it from the title. */
  slug: string;
  lang: Lang;
  coverUrl: string;
  coverAlt: string;
  /** `null` while the settings have not loaded: the Google result goes without the name. */
  siteName: string | null;
  /** Origin of the public site ("https://blog.example"). */
  origin: string;
}

export interface SharePreview {
  title: string;
  description: string;
  /** og:image already absolute; `null` = no image (X shows the small card). */
  image: { src: string; alt: string } | null;
  largeCard: boolean;
  url: string;
  host: string;
  searchTitle: string;
  searchDescription: string;
}

/** An attribute of a renderer-built tag, decoded back from `escapeHtml`. */
const attribute = (tag: string, name: string): string =>
  unescapeHtml(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '');

/** Image URL valid for og:image: the renderer's allowlist and, on top, only http(s) or relative paths. */
function imageUrl(raw: string): string | null {
  const url = sanitizeUrl(raw);
  if (url === null || url.startsWith('#')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
  return scheme && !/^https?$/i.test(scheme) ? null : url;
}

/** The cover; if none, the first image of the text (the generated cover never goes to og:image). */
function shareImage({ coverUrl, coverAlt, html }: ShareInput): { src: string; alt: string } | null {
  const cover = imageUrl(coverUrl);
  if (cover) return { src: cover, alt: coverAlt.trim() };
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = imageUrl(attribute(tag, 'src'));
    if (src) return { src, alt: attribute(tag, 'alt') };
  }
  return null;
}

export function sharePreview(input: ShareInput): SharePreview {
  const title = input.title.trim();
  const description = input.summary.trim() || excerpt(input.body, META_DESCRIPTION_MAX);
  const url = new URL(postPath(input.lang, input.slug.trim() || slugify(title)), input.origin).href;
  const image = shareImage(input);
  return {
    title,
    description,
    // Relative to the post page, as the site resolves the Markdown images.
    image: image && { ...image, src: new URL(image.src, url).href },
    largeCard: image !== null,
    url,
    host: new URL(url).host,
    searchTitle: truncate(input.siteName ? `${title} · ${input.siteName}` : title, SEO_TITLE_MAX),
    searchDescription: truncate(description, META_DESCRIPTION_MAX),
  };
}

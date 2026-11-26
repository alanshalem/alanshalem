import { excerpt, sanitizeUrl, slugify } from '@blog/markdown';
import type { SiteSettings } from '../api/types.ts';
import type { Lang } from '../languages.ts';

/*
 * Cómo ven el post los buscadores y las redes (S3). Es la misma derivación que hace el sitio al publicar
 * (apps/web: BaseLayout.astro para <title> y og:*, lib/posts.ts para la descripción, lib/cover.ts para og:image);
 * el admin no puede importar código de otra app, así que se copia acá y los tests la fijan.
 */

/** Largo de la meta description: el sitio usa `excerpt(body, 160)` cuando el post no tiene resumen. */
export const META_DESCRIPTION_MAX = 160;
/** Lo que Google suele mostrar de un título antes de cortarlo con "…". */
export const SEO_TITLE_MAX = 60;

const POST_SEGMENT: Record<Lang, string> = { es: 'articulos', en: 'articles' };

/** Ruta pública de un post (apps/web/src/lib/i18n.ts, `paths.post`). */
export const postPath = (lang: Lang, slug: string): string => `/${lang}/${POST_SEGMENT[lang]}/${slug}/`;

/** Corta en el último espacio antes de `max` y agrega "…" (lo que hacen los buscadores con lo que no entra). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : text.slice(0, max)).trimEnd()}…`;
}

/** En inglés, `nameEn` si tiene texto; si no, el nombre en español (apps/web/src/lib/settings.ts). */
export function siteNameFor(settings: Pick<SiteSettings, 'name' | 'nameEn'>, lang: Lang): string {
  return (lang === 'en' ? settings.nameEn?.trim() : '') || settings.name.trim();
}

export interface ShareInput {
  title: string;
  summary: string;
  body: string;
  /** El cuerpo ya renderizado (renderPreview): de ahí sale la primera imagen, como en el sitio. */
  html: string;
  /** Vacío = la API lo genera desde el título. */
  slug: string;
  lang: Lang;
  coverUrl: string;
  coverAlt: string;
  /** `null` mientras no se cargaron los ajustes: el resultado de Google va sin el nombre. */
  siteName: string | null;
  /** Origen del sitio público ("https://blog.example"). */
  origin: string;
}

export interface SharePreview {
  title: string;
  description: string;
  /** og:image ya absoluta; `null` = sin imagen (X muestra la tarjeta chica). */
  image: { src: string; alt: string } | null;
  largeCard: boolean;
  url: string;
  host: string;
  searchTitle: string;
  searchDescription: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const attribute = (tag: string, name: string): string =>
  (new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** URL de imagen válida para og:image: la allowlist del renderer y además solo http(s) o rutas relativas. */
function imageUrl(raw: string): string | null {
  const url = sanitizeUrl(raw);
  if (url === null || url.startsWith('#')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
  return scheme && !/^https?$/i.test(scheme) ? null : url;
}

/** La portada; si no hay, la primera imagen del texto (la portada generativa nunca va a og:image). */
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
    // Relativa a la página del post, como resuelve el sitio las imágenes del Markdown.
    image: image && { ...image, src: new URL(image.src, url).href },
    largeCard: image !== null,
    url,
    host: new URL(url).host,
    searchTitle: truncate(input.siteName ? `${title} · ${input.siteName}` : title, SEO_TITLE_MAX),
    searchDescription: truncate(description, META_DESCRIPTION_MAX),
  };
}

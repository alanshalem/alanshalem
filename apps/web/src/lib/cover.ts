import { sanitizeUrl } from '@blog/markdown';
import { generativeCover } from './generative.ts';

/**
 * Portada efectiva de un post (L5): `coverUrl` → primera imagen del Markdown → SVG generativo (S3b).
 * Se resuelve en build time; todo lo de este archivo es puro (sin red, sin entorno).
 */
export type Cover =
  | { kind: 'image'; src: string; alt: string; source: 'cover' | 'markdown' }
  | { kind: 'generative'; svg: string };

export interface CoverInput {
  slug: string;
  /** Tema principal: varía la portada generativa. */
  tag?: string | undefined;
  coverUrl?: string | null | undefined;
  coverAlt?: string | null | undefined;
  /** HTML ya renderizado por @blog/markdown: solo trae <img> con URLs que el renderer aceptó. */
  html: string;
}

/**
 * URL de imagen aceptable: la misma allowlist que @blog/markdown (`sanitizeUrl`)
 * y además solo http(s) o rutas relativas (mailto:/tel: no son imágenes).
 */
export function acceptImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const url = sanitizeUrl(raw);
  if (url === null || url.startsWith('#')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme && !/^https?$/i.test(scheme[1] ?? '')) return null;
  return url;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text: string): string => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);

/** Primera <img> aceptable del HTML renderizado, con src y alt ya sin escapar. */
export function firstMarkdownImage(html: string): { src: string; alt: string } | null {
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const src = acceptImageUrl(decode(/\ssrc="([^"]*)"/.exec(tag)?.[1] ?? ''));
    if (src) return { src, alt: decode(/\salt="([^"]*)"/.exec(tag)?.[1] ?? '') };
  }
  return null;
}

export function resolveCover({ slug, tag, coverUrl, coverAlt, html }: CoverInput): Cover {
  const own = acceptImageUrl(coverUrl);
  if (own) return { kind: 'image', src: own, alt: coverAlt?.trim() ?? '', source: 'cover' };

  const inBody = firstMarkdownImage(html);
  if (inBody) return { kind: 'image', ...inBody, source: 'markdown' };

  return { kind: 'generative', svg: generativeCover(slug, tag ?? '') };
}

/** URL absoluta para og:image (o para usar la imagen fuera de la página del post). */
export function absoluteImageUrl(src: string, base: string): string {
  return new URL(src, base).href;
}

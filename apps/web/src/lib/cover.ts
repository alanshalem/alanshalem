import { sanitizeUrl } from '@blog/markdown';
import { generativeCover } from './generative.ts';
import { readAttribute } from './html.ts';

/**
 * A post's effective cover: `coverUrl` → first Markdown image → generative SVG.
 * Resolved at build time; everything in this file is pure (no network, no environment).
 */
export type Cover =
  | { kind: 'image'; src: string; alt: string; source: 'cover' | 'markdown' }
  | { kind: 'generative'; svg: string };

export interface CoverInput {
  slug: string;
  /** Main topic: varies the generative cover. */
  tag?: string | undefined;
  coverUrl?: string | null | undefined;
  coverAlt?: string | null | undefined;
  /** HTML already rendered by @blog/markdown: it only has <img>s with URLs the renderer accepted. */
  html: string;
}

/**
 * An acceptable image URL: the same allowlist as @blog/markdown (`sanitizeUrl`)
 * and, on top of it, only http(s) or relative paths (mailto:/tel: are not images).
 */
export function acceptImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const url = sanitizeUrl(raw);
  if (url === null || url.startsWith('#')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme && !/^https?$/i.test(scheme[1] ?? '')) return null;
  return url;
}

/** The first acceptable <img> of the rendered HTML, with src and alt already unescaped. */
export function firstMarkdownImage(html: string): { src: string; alt: string } | null {
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const src = acceptImageUrl(readAttribute(tag, 'src'));
    if (src) return { src, alt: readAttribute(tag, 'alt') ?? '' };
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

/** Absolute URL for og:image (or to use the image outside the post's page). */
export function absoluteImageUrl(src: string, base: string): string {
  return new URL(src, base).href;
}

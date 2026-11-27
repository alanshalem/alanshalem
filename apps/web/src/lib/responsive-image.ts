import { htmlAttributes, readAttribute } from './html.ts';
import { safeColor, srcset, type ImageFormat, type MediaAsset, type MediaIndex } from './media.ts';

/**
 * The width the image takes in each context (the `sizes` attribute): with it the browser downloads the right variant.
 * It mirrors the layout of site.css; if a grid changes, change it here.
 */
export const IMAGE_SIZES = {
  /** Home and article hero: full bleed. */
  hero: '100vw',
  /** The featured post's cover: 1.5fr of 2.5fr from 1024px. */
  lead: '(min-width: 1024px) 60vw, 100vw',
  /** Cards: 1, 2 and up to ~3 columns. */
  card: '(min-width: 75em) 33vw, (min-width: 700px) 50vw, 100vw',
  /** Topic tiles: 16rem columns. */
  tile: '(min-width: 700px) 33vw, 100vw',
  /** Images inside the text: the reading column. */
  prose: '(min-width: 640px) 640px, 100vw',
} as const;

export type ImageContext = keyof typeof IMAGE_SIZES;

export interface ImageOptions {
  alt: string;
  context: ImageContext;
  title?: string | undefined;
  /** Hero or first visible image: requested right away and with priority. The rest is deferred. */
  priority?: boolean | undefined;
}

export interface PlainImageOptions extends ImageOptions {
  /** Reserved box for images that are not assets (their real size is unknown). */
  width: number;
  height: number;
}

/** AVIF first: the browser uses the first <source> it supports. */
const SOURCE_FORMATS: readonly ImageFormat[] = ['avif', 'webp'];

function imgTag(src: string, width: number, height: number, options: ImageOptions, style?: string): string {
  return `<img${htmlAttributes({
    src,
    alt: options.alt,
    title: options.title,
    width,
    height,
    loading: options.priority ? 'eager' : 'lazy',
    decoding: 'async',
    fetchpriority: options.priority ? 'high' : undefined,
    style,
  })}>`;
}

function pictureHtml(asset: MediaAsset, options: ImageOptions): string {
  const sizes = IMAGE_SIZES[options.context];
  const sources = SOURCE_FORMATS.map((format) => ({ format, srcset: srcset(asset, format) }))
    .filter((source) => source.srcset !== '')
    .map((source) => `<source${htmlAttributes({ type: `image/${source.format}`, srcset: source.srcset, sizes })}>`)
    .join('');
  const color = safeColor(asset.color);
  // The dominant color paints the box while the image arrives.
  const img = imgTag(asset.url, asset.width, asset.height, options, color ? `background-color:${color}` : undefined);
  return `<picture>${sources}${img}</picture>`;
}

/** An image for any context: an AVIF + WebP <picture> for a known asset; otherwise the plain <img>. */
export function imageHtml(src: string, media: MediaIndex, options: PlainImageOptions): string {
  const asset = media.get(src);
  return asset ? pictureHtml(asset, options) : imgTag(src, options.width, options.height, options);
}

/** Replaces with a <picture> only the Markdown <img>s whose src is exactly a known asset. */
export function responsiveProseHtml(html: string, media: MediaIndex): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const asset = media.get(readAttribute(tag, 'src') ?? '');
    if (!asset) return tag;
    return pictureHtml(asset, {
      alt: readAttribute(tag, 'alt') ?? '',
      title: readAttribute(tag, 'title') ?? undefined,
      context: 'prose',
    });
  });
}

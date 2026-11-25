import { escapeHtml } from '@blog/markdown';
import { readAttribute } from './html.ts';
import { safeColor, srcset, type ImageFormat, type MediaAsset, type MediaIndex } from './media.ts';

/**
 * Ancho que ocupa la imagen en cada contexto (atributo `sizes`): con eso el navegador baja la variante justa.
 * Refleja el layout de site.css; si cambia una grilla, se cambia acá.
 */
export const IMAGE_SIZES = {
  /** Hero de la home y del artículo: a sangre. */
  hero: '100vw',
  /** Portada del destacado: 1.5fr de 2.5fr desde 1024px. */
  lead: '(min-width: 1024px) 60vw, 100vw',
  /** Tarjetas: 1, 2 y hasta ~3 columnas. */
  card: '(min-width: 75em) 33vw, (min-width: 700px) 50vw, 100vw',
  /** Mosaicos de temas: columnas de 16rem. */
  tile: '(min-width: 700px) 33vw, 100vw',
  /** Imágenes dentro del texto: la columna de lectura. */
  prose: '(min-width: 640px) 640px, 100vw',
} as const;

export type ImageContext = keyof typeof IMAGE_SIZES;

export interface ImageOptions {
  alt: string;
  context: ImageContext;
  title?: string | undefined;
  /** Hero o primera imagen visible: se pide ya y con prioridad. El resto se difiere. */
  priority?: boolean | undefined;
}

export interface PlainImageOptions extends ImageOptions {
  /** Caja reservada para imágenes que no son assets (no conocemos sus medidas reales). */
  width: number;
  height: number;
}

/** El AVIF primero: el navegador usa la primera <source> que soporta. */
const SOURCE_FORMATS: readonly ImageFormat[] = ['avif', 'webp'];

const attributes = (values: Record<string, string | number | undefined>): string =>
  Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
    .join('');

function imgTag(src: string, width: number, height: number, options: ImageOptions, style?: string): string {
  return `<img${attributes({
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
    .map((source) => `<source${attributes({ type: `image/${source.format}`, srcset: source.srcset, sizes })}>`)
    .join('');
  const color = safeColor(asset.color);
  // El color dominante pinta la caja mientras llega la imagen.
  const img = imgTag(asset.url, asset.width, asset.height, options, color ? `background-color:${color}` : undefined);
  return `<picture>${sources}${img}</picture>`;
}

/** Imagen para cualquier contexto: <picture> AVIF + WebP si es un asset conocido; si no, el <img> simple. */
export function imageHtml(src: string, media: MediaIndex, options: PlainImageOptions): string {
  const asset = media.get(src);
  return asset ? pictureHtml(asset, options) : imgTag(src, options.width, options.height, options);
}

/** Cambia por <picture> solo las <img> del Markdown cuyo src es exactamente un asset conocido. */
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

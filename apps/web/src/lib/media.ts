import { getInternal } from './api.ts';

/**
 * Imágenes optimizadas por la API al subirlas (L10): AVIF + WebP en varios anchos, color dominante y placeholder.
 * Todo menos `getMediaIndex` es puro.
 */
export type ImageFormat = 'avif' | 'webp';

export interface MediaVariant {
  format: ImageFormat;
  width: number;
  url: string;
}

/** MediaAssetDto (GET /api/internal/media). */
export interface MediaAsset {
  id: string;
  /** WebP del mayor ancho ≤ 1600: el <img> de respaldo y la imagen para og:image. */
  url: string;
  /** Medidas del original ya rotado. */
  width: number;
  height: number;
  /** Color dominante `#rrggbb`. */
  color: string;
  /** WebP diminuto en data URI. */
  placeholder: string;
  variants: MediaVariant[];
  createdAt: string;
}

/** Cualquier URL de un asset (la principal o la de una variante) → el asset. */
export type MediaIndex = ReadonlyMap<string, MediaAsset>;

export function indexMedia(assets: readonly MediaAsset[]): MediaIndex {
  const index = new Map<string, MediaAsset>();
  for (const asset of assets) {
    index.set(asset.url, asset);
    for (const variant of asset.variants) index.set(variant.url, asset);
  }
  return index;
}

/** Valor de `srcset` con las variantes de un formato, de la más chica a la más grande. */
export function srcset(asset: MediaAsset, format: ImageFormat): string {
  return asset.variants
    .filter((variant) => variant.format === format)
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ');
}

// Los valores van a parar a atributos `style`: solo se aceptan las formas exactas que produce el pipeline.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PLACEHOLDER_DATA_URI = /^data:image\/webp;base64,[a-z0-9+/]+=*$/i;

export const safeColor = (color: string): string | null => (HEX_COLOR.test(color) ? color : null);
export const safePlaceholder = (placeholder: string): string | null =>
  PLACEHOLDER_DATA_URI.test(placeholder) ? placeholder : null;

// Una sola petición por build (Astro renderiza todas las páginas en el mismo proceso).
let cache: Promise<MediaIndex> | undefined;

export function getMediaIndex(): Promise<MediaIndex> {
  return (cache ??= getInternal<MediaAsset[]>('/api/internal/media', 'las imágenes subidas').then(indexMedia));
}

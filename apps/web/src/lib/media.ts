import { getInternal, oncePerBuild } from './api.ts';

/**
 * Images optimized by the API on upload: AVIF + WebP in several widths, dominant color and placeholder.
 * Everything except `getMediaIndex` is pure.
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
  /** WebP of the largest width ≤ 1600: the fallback <img> and the og:image. */
  url: string;
  /** Size of the original, already rotated. */
  width: number;
  height: number;
  /** Dominant color `#rrggbb`. */
  color: string;
  /** Tiny WebP as a data URI. */
  placeholder: string;
  variants: MediaVariant[];
  createdAt: string;
}

/** Any URL of an asset (the main one or a variant's) → the asset. */
export type MediaIndex = ReadonlyMap<string, MediaAsset>;

export function indexMedia(assets: readonly MediaAsset[]): MediaIndex {
  const index = new Map<string, MediaAsset>();
  for (const asset of assets) {
    index.set(asset.url, asset);
    for (const variant of asset.variants) index.set(variant.url, asset);
  }
  return index;
}

/** `srcset` value with the variants of one format, smallest to largest. */
export function srcset(asset: MediaAsset, format: ImageFormat): string {
  return asset.variants
    .filter((variant) => variant.format === format)
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ');
}

// These values end up in `style` attributes: only the exact shapes the pipeline produces are accepted.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PLACEHOLDER_DATA_URI = /^data:image\/webp;base64,[a-z0-9+/]+=*$/i;

export const safeColor = (color: string): string | null => (HEX_COLOR.test(color) ? color : null);
export const safePlaceholder = (placeholder: string): string | null =>
  PLACEHOLDER_DATA_URI.test(placeholder) ? placeholder : null;

export const getMediaIndex: () => Promise<MediaIndex> = oncePerBuild(() =>
  getInternal<MediaAsset[]>('/api/internal/media', 'the uploaded images').then(indexMedia),
);

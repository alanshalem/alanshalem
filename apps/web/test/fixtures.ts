import type { MediaAsset } from '../src/lib/media.ts';

/** MediaAssetDto como lo entrega la API (L10): WebP + AVIF en los anchos ≤ original, `url` = WebP ≤ 1600. */
export function mediaAsset(hash: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  const widths = [640, 1024, 1600];
  return {
    id: `id-${hash}`,
    url: `/media/${hash}/1600.webp`,
    width: 2000,
    height: 1125,
    color: '#336699',
    placeholder: 'data:image/webp;base64,UklGRhIAAABXRUJQ',
    variants: (['avif', 'webp'] as const).flatMap((format) =>
      widths.map((width) => ({ format, width, url: `/media/${hash}/${width}.${format}` })),
    ),
    createdAt: '2026-11-01T10:00:00Z',
    ...overrides,
  };
}

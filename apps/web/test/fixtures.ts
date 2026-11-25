import type { MediaAsset } from '../src/lib/media.ts';
import type { VideoAsset, VideoCodec, VideoHeight } from '../src/lib/video.ts';

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

/**
 * VideoAssetDto listo (L13), con las fuentes a propósito en el orden "equivocado" (H.264 y 720p primero):
 * el sitio no puede depender del orden en que las mande la API.
 */
export function videoAsset(hash: string, overrides: Partial<VideoAsset> = {}): VideoAsset {
  const codecs: readonly VideoCodec[] = ['h264', 'av1'];
  const heights: readonly VideoHeight[] = [720, 1080];
  return {
    id: `video-${hash}`,
    status: 'ready',
    error: null,
    width: 1920,
    height: 1080,
    durationSeconds: 3,
    poster: mediaAsset(`poster-${hash}`),
    sources: codecs.flatMap((codec) =>
      heights.map((height) => ({
        codec,
        height,
        url: `/media/videos/${hash}/${height}.${codec}.mp4`,
        bytes: height * 1000,
      })),
    ),
    warnings: [],
    createdAt: '2026-11-01T10:00:00Z',
    ...overrides,
  };
}

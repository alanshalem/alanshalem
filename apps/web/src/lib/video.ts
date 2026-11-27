import { htmlAttributes } from './html.ts';
import type { MediaAsset } from './media.ts';

/** Videos processed by the API: no audio, AV1 + H.264 in MP4, 720p and 1080p (never upscaled). All pure. */
export type VideoCodec = 'av1' | 'h264';
export type VideoHeight = 720 | 1080;

export interface VideoSource {
  codec: VideoCodec;
  height: VideoHeight;
  url: string;
  bytes: number;
}

/** VideoAssetDto. The site's gallery only receives videos in `ready`. */
export interface VideoAsset {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  poster: MediaAsset | null;
  sources: VideoSource[];
  warnings: string[];
  createdAt: string;
}

/**
 * The exact `type` of what libsvtav1 and libx264 (high, yuv420p) write with an automatic level, verified by reading
 * the av1C/avcC boxes of their output: AV1 Main 8-bit level 3.1 / 4.0 and H.264 High level 3.1 / 4.0 (at ≤ 30 fps
 * and 16:9 the level depends only on the height). The browser skips, without downloading, a source it cannot
 * decode; declaring the real level avoids discarding 720p on devices that do not reach 4.0.
 */
const SOURCE_TYPES: Record<VideoCodec, Record<VideoHeight, string>> = {
  av1: { 720: 'video/mp4; codecs="av01.0.05M.08"', 1080: 'video/mp4; codecs="av01.0.08M.08"' },
  h264: { 720: 'video/mp4; codecs="avc1.64001f"', 1080: 'video/mp4; codecs="avc1.640028"' },
};

/** AV1 first: it weighs much less at the same quality; H.264 is the fallback (old Safari, devices without AV1). */
const CODEC_PREFERENCE: readonly VideoCodec[] = ['av1', 'h264'];

/**
 * The browser uses the first <source> it can play whose `media` matches (each device downloads only what it
 * needs). 720p (1280 px wide) is enough for phones and portrait tablets; from a 1024 px viewport (landscape
 * tablets, laptops, desktop) it gets 1080p.
 */
const FULL_HD_MEDIA = '(min-width: 1024px)';

/** By preferred codec and, within each, the largest first (the smallest has no `media`: it is the floor). */
const byPreference = (a: VideoSource, b: VideoSource): number =>
  CODEC_PREFERENCE.indexOf(a.codec) - CODEC_PREFERENCE.indexOf(b.codec) || b.height - a.height;

const sourceTag = ({ codec, height, url }: VideoSource): string =>
  `<source${htmlAttributes({
    src: url,
    type: SOURCE_TYPES[codec][height],
    // Only 1080p is conditional: 720p is the pipeline's floor and works on any screen.
    media: height === 1080 ? FULL_HD_MEDIA : undefined,
  })}>`;

/** A video's <source>s, in the order the browser should try them. */
export const videoSourcesHtml = (video: VideoAsset): string =>
  [...video.sources].sort(byPreference).map(sourceTag).join('');

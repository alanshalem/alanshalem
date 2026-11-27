import type { HeroImage, VideoAsset } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';
import { checkHeroSize } from './heroSize.ts';

/* Pure rules of the hero videos: which files are videos, how often to poll and what to preview. */

export type HeroMediaKind = 'photo' | 'video';

// The containers the API accepts. One list builds the input's `accept` and the extension fallback.
const VIDEO_FORMATS = [
  { mime: 'video/mp4', extension: '.mp4' },
  { mime: 'video/quicktime', extension: '.mov' },
  { mime: 'video/webm', extension: '.webm' },
  { mime: 'video/x-matroska', extension: '.mkv' },
] as const;

export const VIDEO_ACCEPT = VIDEO_FORMATS.flatMap(({ mime, extension }) => [mime, extension]).join(',');

/**
 * Which flow a file goes to, by its MIME type. Some systems do not know the .mkv MIME and leave it empty: then the
 * extension decides. Anything else is not for the hero (the API would reject it anyway).
 */
export function heroMediaKind(file: { type: string; name: string }): HeroMediaKind | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  const name = file.name.toLowerCase();
  if (file.type === '' && VIDEO_FORMATS.some(({ extension }) => name.endsWith(extension))) return 'video';
  return null;
}

/** A saved item is a video if it has `video` (its `media` is the poster); otherwise a photo. */
export const heroItemKind = (image: HeroImage): HeroMediaKind => (image.video ? 'video' : 'photo');

// A 15 s video takes seconds to minutes (AV1 is slow): poll often at first and space it out later.
const POLL = { firstMs: 2000, factor: 1.5, maxMs: 15000 } as const;

/** Wait before poll number `attempt` (from 0). */
export const pollDelay = (attempt: number): number => Math.min(POLL.firstMs * POLL.factor ** attempt, POLL.maxMs);

/** The pending file's status matching the video's status in the API (its error, if any, as is). */
export function videoProgress(
  video: VideoAsset,
  i18n: I18n,
): { status: 'processing' | 'uploaded' | 'failed'; error: string | null } {
  switch (video.status) {
    case 'processing':
      return { status: 'processing', error: null };
    case 'ready':
      return { status: 'uploaded', error: null };
    case 'failed':
      return { status: 'failed', error: video.error ?? i18n.t('hero.videoFailed') };
  }
}

/**
 * The non-blocking warnings of an uploaded video: the admin's own size rule (`checkHeroSize`, the same one the local
 * precheck runs) applied to the size the API measured, in the UI language. The API's `video.warnings` are not shown,
 * so there is one source for what the admin says (and it also covers files the browser could not measure).
 */
export function videoWarnings(video: VideoAsset, i18n: I18n): string[] {
  const check = checkHeroSize(video, i18n);
  return check.ok && check.warning ? [check.warning] : [];
}

/** The lightest H.264 source: any browser plays it and it is enough for a moving thumbnail. */
export function previewSourceUrl(video: VideoAsset): string | null {
  const h264 = video.sources.filter((source) => source.codec === 'h264');
  if (h264.length === 0) return null;
  return h264.reduce((lightest, source) => (source.height < lightest.height ? source : lightest)).url;
}

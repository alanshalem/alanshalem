import type { Lang } from '../languages.ts';
import type { LIMITS } from '../limits.ts';

export type PostStatus = 'draft' | 'published';

/** Another version of the same post in another language (`translations` of `PostDto` and `PostSummaryDto`). */
export interface PostTranslation {
  id: string;
  lang: Lang;
  slug: string;
  status: PostStatus;
  updatedAt: string;
  /** Last change of its content; publishing, unpublishing or scheduling do not move it (see `PostSummary`). */
  contentUpdatedAt: string;
}

/** A row of the post list (without the body, so the list stays light). */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  /** Last change of any kind, status included: sorts and dates the list. */
  updatedAt: string;
  /**
   * Last change of the content (creation included). It is the date that tells whether a translation fell behind:
   * publishing the original leaves nothing new to translate.
   */
  contentUpdatedAt: string;
  publishedAt: string | null;
  /** When the server publishes it on its own (UTC); drafts only: publishing or cancelling clears it. */
  scheduledAt: string | null;
  /** Optional cover: a `/media/...` path (uploaded) or an `http(s)` URL. */
  coverUrl: string | null;
  coverAlt: string | null;
  lang: Lang;
  /** The versions of one post in different languages share a group (at most one per language). */
  translationGroupId: string;
  /** The other versions of the group; empty if there are none. */
  translations: PostTranslation[];
}

export interface Post extends PostSummary {
  summary: string;
  body: string;
  tags: string[];
  createdAt: string;
}

/**
 * What the editor sends on save. Empty `slug` = the API generates it from the title. The language is not here: it is
 * only chosen on create (`api.createPost`) and never changes afterwards.
 * Without a cover (`coverUrl: null`) the site uses the first image of the text or, if none, a generated cover.
 */
export interface PostInput {
  title: string;
  slug: string;
  summary: string;
  body: string;
  tags: string[];
  coverUrl: string | null;
  coverAlt: string | null;
}

/** A revision in the history list (`PostRevisionSummaryDto`): without the body, which is fetched when opened. */
export interface PostRevisionSummary {
  id: string;
  /** 1, 2, 3…: the save order (the list arrives newest first). */
  number: number;
  createdAt: string;
  title: string;
  /** Characters of the body: a hint of its size without fetching it. */
  bodyLength: number;
}

/** A full revision (`PostRevisionDto`): the content snapshot, with the same shape as what is saved. */
export interface PostRevision extends PostInput {
  id: string;
  number: number;
  createdAt: string;
}

/**
 * Author and site data (one single row in the API). Everything optional except `name`;
 * empty values travel as `null`. The same object serves the GET and the PUT.
 */
export interface SiteSettings {
  name: string;
  /** Short phrase for `<meta name="description">`. */
  tagline: string | null;
  /** Short Markdown; the site renders it with @blog/markdown. */
  bio: string | null;
  /** English versions of `tagline` and `bio`; `null` = the English site uses the Spanish ones. The name is a single field. */
  taglineEn: string | null;
  bioEn: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

/** An optimized version of an uploaded image (AVIF and WebP in several widths). */
export interface MediaVariant {
  format: 'avif' | 'webp';
  width: number;
  url: string;
}

/** `MediaAssetDto`: what `POST /api/admin/media` returns. */
export interface MediaAsset {
  id: string;
  /** WebP of the largest width ≤ 1600: the URL the Markdown and the covers use. */
  url: string;
  width: number;
  height: number;
  /** Dominant color `#rrggbb`. */
  color: string;
  /** Blurred ~16 px thumbnail as a data URI, shown while the real image loads. */
  placeholder: string;
  variants: MediaVariant[];
  createdAt: string;
}

export type VideoStatus = 'processing' | 'ready' | 'failed';

/** A processed version of the video (AV1 and H.264, 720p and 1080p, no audio). */
export interface VideoSource {
  codec: 'av1' | 'h264';
  height: 720 | 1080;
  url: string;
  bytes: number;
}

/** How the video joins itself when it repeats in the hero. */
export type VideoFade = 'loop' | 'black' | 'none';

/** The durations the API accepts (VideoEdit.FadeDurations), from src/limits.ts. */
export type FadeSeconds = (typeof LIMITS.video.fadeSeconds)[number];

/**
 * Trim and fade the API applies when processing: the multipart fields of the upload and the `edit` of the
 * `VideoAssetDto`. Seconds of the original file.
 */
export interface VideoEdit {
  trimStart: number;
  trimEnd: number;
  fade: VideoFade;
  /** Also sent with `fade: 'none'` (the API ignores it): so the choice is not lost when switching fades. */
  fadeSeconds: FadeSeconds;
}

/**
 * `VideoAssetDto`: what `POST /api/admin/media/videos` (202, in `processing`) and `GET /api/admin/media/videos/{id}`
 * return. Processing runs in the background: poll until `ready` or `failed`.
 */
export interface VideoAsset {
  id: string;
  status: VideoStatus;
  error: string | null;
  width: number;
  height: number;
  /** The final duration (already trimmed). */
  durationSeconds: number;
  edit: VideoEdit;
  /** First useful frame, optimized like any photo; `null` while processing. */
  poster: MediaAsset | null;
  sources: VideoSource[];
  /** Warnings that do not prevent using it (for example, smaller than ideal). */
  warnings: string[];
  createdAt: string;
}

/** `HeroImageDto`: a photo or a video of the hero gallery (the home page shows a random one on every visit). */
export interface HeroImage {
  id: string;
  /** The photo; for a video, its poster. */
  media: MediaAsset;
  video: VideoAsset | null;
  alt: string;
  credit: string | null;
  /** English version of `alt`; `null` = the English site uses the Spanish one. The credit is a single field. */
  altEn: string | null;
  createdAt: string;
}

/** Which asset a new hero item is attached to: an uploaded photo or an already processed (`ready`) video. */
export type HeroMediaRef = { mediaId: string } | { videoId: string };

/** What is edited of a hero item (PUT body; the POST adds the `HeroMediaRef`). */
export interface HeroImageInput {
  alt: string;
  credit: string | null;
  altEn: string | null;
}

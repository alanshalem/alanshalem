import type { I18n } from '../i18n/i18n.ts';
import { LIMITS } from '../limits.ts';
import { VIDEO_DURATION } from './videoEdit.ts';

/*
 * The hero size rule, one for photos and videos, mirroring the API domain's: it warns before uploading (and before
 * spending minutes on a video that will be rejected). The API stays the authority. Duration is not part of this rule:
 * a long video is trimmed in the editor (videoEdit.ts); its size cannot be.
 */

/** Ideal, minimum and minimum aspect (width/height as a fraction): below it the image is portrait or nearly square and
 * the hero would crop it badly. The numbers come from src/limits.ts. */
export const HERO_SIZE = LIMITS.heroFrame;

interface Size {
  width: number;
  height: number;
}

/** Sizes read from the file; `durationSeconds` only exists for videos (the trim editor uses it). */
export interface MediaDimensions extends Size {
  durationSeconds?: number | undefined;
}

export type HeroSizeCheck = { ok: true; warning: string | null } | { ok: false; error: string };

const formatSize = ({ width, height }: Size): string => `${width}×${height}`;

const IDEAL = formatSize(HERO_SIZE.ideal);

/** The guide shown next to "Subir", built from the same numbers as the rules. */
export const heroGuidance = (i18n: I18n): string =>
  i18n.t('hero.guidance', { ideal: IDEAL, min: VIDEO_DURATION.minSeconds, max: VIDEO_DURATION.maxSeconds });

const isBelow = (size: Size, limit: Size): boolean => size.width < limit.width || size.height < limit.height;

/** First the shape, then the size: the most useful error for picking another file. */
export function checkHeroSize(dimensions: MediaDimensions, i18n: I18n): HeroSizeCheck {
  const sizes = { received: formatSize(dimensions), ideal: IDEAL, min: formatSize(HERO_SIZE.min) };

  const { numerator, denominator } = HERO_SIZE.minAspect;
  // In integers, like the API (width × 5 < height × 6): no floating point rounding at the edge.
  if (dimensions.width * denominator < dimensions.height * numerator) {
    return { ok: false, error: i18n.t('hero.notLandscape', sizes) };
  }
  if (isBelow(dimensions, HERO_SIZE.min)) return { ok: false, error: i18n.t('hero.tooSmall', sizes) };

  const warning = isBelow(dimensions, HERO_SIZE.ideal) ? i18n.t('hero.belowIdeal', sizes) : null;
  return { ok: true, warning };
}

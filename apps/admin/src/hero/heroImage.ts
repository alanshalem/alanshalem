import type { HeroImage, HeroImageInput, MediaAsset } from '../api/types.ts';
import type { I18n, MessageKey } from '../i18n/i18n.ts';
import type { PendingUpload } from './useHeroImages.ts';
import { LIMITS } from '../limits.ts';
import { cleanOptional, tooLongMessage } from '../settings/validate.ts';

/*
 * Pure rules of a hero photo, mirroring the API contract: they warn before sending. The API stays the authority and
 * its errors (ProblemDetails) are shown anyway. Texts come from the received `I18n`.
 */

/** The English alt text has the same limit as its Spanish counterpart; the credit is a single field. */
export const HERO_IMAGE_LIMITS = {
  alt: LIMITS.heroImage.alt,
  credit: LIMITS.heroImage.credit,
  altEn: LIMITS.heroImage.alt,
} as const satisfies Record<keyof HeroImageInput, number>;

/** What the card's inputs edit: all text (the API's `null` shows as empty). */
export type HeroImageFields = { [K in keyof HeroImageInput]: string };
export type HeroImageErrors = Partial<Record<keyof HeroImageInput, string>>;
export type HeroImageValidation = { ok: true; input: HeroImageInput } | { ok: false; errors: HeroImageErrors };

/** The saved values as input text; without a saved item (a new photo), all empty. */
export const toHeroImageFields = (saved?: HeroImageInput): HeroImageFields => ({
  alt: saved?.alt ?? '',
  credit: saved?.credit ?? '',
  altEn: saved?.altEn ?? '',
});

/** Validates every field at once (to flag them together) and returns the body ready for the POST/PUT. */
export function validateHeroImage(fields: HeroImageFields, i18n: I18n): HeroImageValidation {
  const errors: HeroImageErrors = {};
  const optional = (key: 'credit' | 'altEn', subject: MessageKey): string | null => {
    const value = cleanOptional(fields[key]);
    if (value !== null && value.length > HERO_IMAGE_LIMITS[key]) {
      errors[key] = tooLongMessage(i18n, subject, HERO_IMAGE_LIMITS[key]);
    }
    return value;
  };

  const alt = fields.alt.trim();
  if (alt === '') errors.alt = i18n.t('hero.altRequired');
  else if (alt.length > HERO_IMAGE_LIMITS.alt) errors.alt = tooLongMessage(i18n, 'subject.alt', HERO_IMAGE_LIMITS.alt);
  const credit = optional('credit', 'subject.credit');
  const altEn = optional('altEn', 'subject.altEn');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { alt, credit, altEn } };
}

/**
 * "Descartar" on a file in progress asks first only if finished work would be lost: a video the API is processing or
 * an already uploaded file still to be described. In the editor, queued, uploading or failed it is discarded right
 * away. `null` = do not ask.
 */
export function discardConfirmation(upload: Pick<PendingUpload, 'status' | 'fileName'>, { t }: I18n): string | null {
  return upload.status === 'processing' || upload.status === 'uploaded'
    ? t(`hero.confirmDiscard.${upload.status}`, { name: upload.fileName })
    : null;
}

/** The lightest WebP variant: enough for a thumbnail and avoids downloading the 1600 px photo. */
export function thumbnailUrl(media: MediaAsset): string {
  const webp = media.variants.filter((variant) => variant.format === 'webp');
  if (webp.length === 0) return media.url;
  return webp.reduce((smallest, variant) => (variant.width < smallest.width ? variant : smallest)).url;
}

/** Upload order (the same the site uses: the first one is the `<noscript>` and `og:image` one). */
export const inUploadOrder = (images: readonly HeroImage[]): HeroImage[] =>
  [...images].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

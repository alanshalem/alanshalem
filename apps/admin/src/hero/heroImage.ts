import type { HeroImage, HeroImageInput, MediaAsset } from '../api/types.ts';
import { cleanOptional } from '../settings/validate.ts';

/*
 * Reglas puras de una foto del hero, espejo del contrato de la API (L10): sirven para avisar antes de enviar.
 * La API sigue siendo la autoridad y sus errores (ProblemDetails) se muestran igual.
 */

export const HERO_IMAGE_LIMITS = { alt: 300, credit: 200 } as const;

export type HeroImageErrors = Partial<Record<keyof HeroImageInput, string>>;
export type HeroImageValidation = { ok: true; input: HeroImageInput } | { ok: false; errors: HeroImageErrors };

/** Valida los dos campos a la vez (para marcar ambos) y devuelve el cuerpo listo para el POST/PUT. */
export function validateHeroImage(alt: string, credit: string): HeroImageValidation {
  const errors: HeroImageErrors = {};

  const cleanAlt = alt.trim();
  if (cleanAlt === '') errors.alt = 'El texto alternativo es obligatorio.';
  else if (cleanAlt.length > HERO_IMAGE_LIMITS.alt) {
    errors.alt = `El texto alternativo no puede superar ${HERO_IMAGE_LIMITS.alt} caracteres.`;
  }

  const cleanCredit = cleanOptional(credit);
  if (cleanCredit !== null && cleanCredit.length > HERO_IMAGE_LIMITS.credit) {
    errors.credit = `El crédito no puede superar ${HERO_IMAGE_LIMITS.credit} caracteres.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { alt: cleanAlt, credit: cleanCredit } };
}

/** La variante WebP más liviana: alcanza para una miniatura y evita bajar la foto de 1600 px. */
export function thumbnailUrl(media: MediaAsset): string {
  const webp = media.variants.filter((variant) => variant.format === 'webp');
  if (webp.length === 0) return media.url;
  return webp.reduce((smallest, variant) => (variant.width < smallest.width ? variant : smallest)).url;
}

/** Orden de subida (el mismo que usa el sitio: la primera es la de `<noscript>` y `og:image`). */
export const inUploadOrder = (images: readonly HeroImage[]): HeroImage[] =>
  [...images].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

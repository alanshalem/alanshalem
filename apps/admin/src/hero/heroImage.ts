import type { HeroImage, HeroImageInput, MediaAsset } from '../api/types.ts';
import { cleanOptional } from '../settings/validate.ts';

/*
 * Reglas puras de una foto del hero, espejo del contrato de la API (L10): sirven para avisar antes de enviar.
 * La API sigue siendo la autoridad y sus errores (ProblemDetails) se muestran igual.
 */

const ALT_MAX = 300;
const CREDIT_MAX = 200;

/** Los textos en inglés tienen los mismos límites que su par en español (L4). */
export const HERO_IMAGE_LIMITS = {
  alt: ALT_MAX,
  credit: CREDIT_MAX,
  altEn: ALT_MAX,
  creditEn: CREDIT_MAX,
} as const satisfies Record<keyof HeroImageInput, number>;

/** Lo que editan los inputs de la tarjeta: todo texto (los `null` de la API se ven como vacío). */
export type HeroImageFields = { [K in keyof HeroImageInput]: string };
export type HeroImageErrors = Partial<Record<keyof HeroImageInput, string>>;
export type HeroImageValidation = { ok: true; input: HeroImageInput } | { ok: false; errors: HeroImageErrors };

/** Lo guardado como texto de los inputs; sin ítem guardado (una foto nueva), todo vacío. */
export const toHeroImageFields = (saved?: HeroImageInput): HeroImageFields => ({
  alt: saved?.alt ?? '',
  credit: saved?.credit ?? '',
  altEn: saved?.altEn ?? '',
  creditEn: saved?.creditEn ?? '',
});

/** Valida todos los campos a la vez (para marcarlos juntos) y devuelve el cuerpo listo para el POST/PUT. */
export function validateHeroImage(fields: HeroImageFields): HeroImageValidation {
  const errors: HeroImageErrors = {};
  const optional = (key: 'credit' | 'altEn' | 'creditEn', what: string): string | null => {
    const value = cleanOptional(fields[key]);
    if (value !== null && value.length > HERO_IMAGE_LIMITS[key]) {
      errors[key] = `${what} no puede superar ${HERO_IMAGE_LIMITS[key]} caracteres.`;
    }
    return value;
  };

  const alt = fields.alt.trim();
  if (alt === '') errors.alt = 'El texto alternativo es obligatorio.';
  else if (alt.length > HERO_IMAGE_LIMITS.alt) {
    errors.alt = `El texto alternativo no puede superar ${HERO_IMAGE_LIMITS.alt} caracteres.`;
  }
  const credit = optional('credit', 'El crédito');
  const altEn = optional('altEn', 'El texto alternativo en inglés');
  const creditEn = optional('creditEn', 'El crédito en inglés');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { alt, credit, altEn, creditEn } };
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

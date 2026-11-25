import { VIDEO_DURATION } from './videoEdit.ts';

/*
 * Regla de tamaño del hero (L13, S10), una sola para fotos y videos y espejo de la del dominio de la API:
 * avisa antes de subir (y de gastar minutos en un video que se va a rechazar). La API sigue siendo la autoridad.
 * La duración no es de esta regla: un video largo se recorta en el editor (L19, videoEdit.ts); el tamaño, no.
 */

export const HERO_SIZE = {
  ideal: { width: 1920, height: 1080 },
  min: { width: 1280, height: 720 },
  /** Ancho mínimo como múltiplo del alto: por debajo es vertical o casi cuadrado y el hero lo recortaría mal. */
  minAspect: 1.2,
} as const;

interface Size {
  width: number;
  height: number;
}

/** Medidas leídas del archivo; `durationSeconds` solo existe para videos (la usa el editor de recorte). */
export interface MediaDimensions extends Size {
  durationSeconds?: number | undefined;
}

export type HeroSizeCheck = { ok: true; warning: string | null } | { ok: false; error: string };

const formatSize = ({ width, height }: Size): string => `${width}×${height}`;

const IDEAL = formatSize(HERO_SIZE.ideal);

export const HERO_GUIDANCE =
  `Ideal: ${IDEAL} o más, horizontal 16:9. ` +
  `Videos: de ${VIDEO_DURATION.minSeconds} a ${VIDEO_DURATION.maxSeconds} segundos (antes de subir elegís el tramo); ` +
  'se les quita el audio.';

const isBelow = (size: Size, limit: Size): boolean => size.width < limit.width || size.height < limit.height;

/** Primero el formato, después el tamaño: el error más útil para elegir otro archivo. */
export function checkHeroSize(dimensions: MediaDimensions): HeroSizeCheck {
  const received = formatSize(dimensions);

  if (dimensions.width < HERO_SIZE.minAspect * dimensions.height) {
    return {
      ok: false,
      error: `Formato vertical o cuadrado (${received}): el hero necesita uno horizontal. Ideal: ${IDEAL} (16:9).`,
    };
  }
  if (isBelow(dimensions, HERO_SIZE.min)) {
    return {
      ok: false,
      error: `Tamaño insuficiente (${received}): el mínimo es ${formatSize(HERO_SIZE.min)}. Ideal: ${IDEAL} o más.`,
    };
  }

  const warning = isBelow(dimensions, HERO_SIZE.ideal)
    ? `Mide ${received}, menos que lo ideal (${IDEAL}): puede perder nitidez en pantallas grandes.`
    : null;
  return { ok: true, warning };
}

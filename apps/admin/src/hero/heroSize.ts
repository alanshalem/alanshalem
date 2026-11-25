/*
 * Regla de tamaño del hero (L13, S10, S12), una sola para fotos y videos y espejo de la del dominio de la API:
 * avisa antes de subir (y de gastar minutos en un video que se va a rechazar). La API sigue siendo la autoridad.
 */

export const HERO_SIZE = {
  ideal: { width: 1920, height: 1080 },
  min: { width: 1280, height: 720 },
  /** Ancho mínimo como múltiplo del alto: por debajo es vertical o casi cuadrado y el hero lo recortaría mal. */
  minAspect: 1.2,
  maxVideoSeconds: 15,
} as const;

interface Size {
  width: number;
  height: number;
}

/** Medidas leídas del archivo; `durationSeconds` solo existe para videos. */
export interface MediaDimensions extends Size {
  durationSeconds?: number | undefined;
}

export type HeroSizeCheck = { ok: true; warning: string | null } | { ok: false; error: string };

const formatSize = ({ width, height }: Size): string => `${width}×${height}`;
const seconds = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

const IDEAL = formatSize(HERO_SIZE.ideal);

export const HERO_GUIDANCE =
  `Ideal: ${IDEAL} o más, horizontal 16:9. ` +
  `Videos: hasta ${HERO_SIZE.maxVideoSeconds} segundos; se les quita el audio.`;

const isBelow = (size: Size, limit: Size): boolean => size.width < limit.width || size.height < limit.height;

/** Primero el formato, después el tamaño y la duración: el error más útil para elegir otro archivo. */
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
  const { durationSeconds } = dimensions;
  if (durationSeconds !== undefined && durationSeconds > HERO_SIZE.maxVideoSeconds) {
    return { ok: false, error: `Dura ${seconds.format(durationSeconds)} s: el máximo es ${HERO_SIZE.maxVideoSeconds} s.` };
  }

  const warning = isBelow(dimensions, HERO_SIZE.ideal)
    ? `Mide ${received}, menos que lo ideal (${IDEAL}): puede perder nitidez en pantallas grandes.`
    : null;
  return { ok: true, warning };
}

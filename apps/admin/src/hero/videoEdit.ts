import type { FadeSeconds, VideoEdit, VideoFade } from '../api/types.ts';

/*
 * Reglas puras del editor de recorte y fundido (L19, S12–S15), espejo de la validación de la API: el tramo, el
 * teclado de las manijas, la vista previa aproximada y los textos. Todo en segundos del archivo original y en
 * décimas, que es la resolución que ve y mueve el usuario. La API sigue siendo la autoridad.
 */

/** Lo que puede durar el tramo elegido (S12). */
export const VIDEO_DURATION = { minSeconds: 1, maxSeconds: 15 } as const;

/** Flechas: una décima; con Shift (o PageUp/PageDown), un segundo. */
const TIME_STEP = { fine: 0.1, coarse: 1 } as const;

// Un texto por cada VideoFade: el Record obliga a que no falte ninguno si la API suma otro.
const FADE_TEXT = {
  loop: { label: 'Loop perfecto', description: 'El final se funde con el principio: vuelve a empezar sin salto.' },
  black: { label: 'Desde y hacia negro', description: 'Aparece desde negro al empezar y se va a negro al terminar.' },
  none: { label: 'Sin fundido', description: 'Corte directo: al terminar vuelve a empezar tal cual.' },
} as const satisfies Record<VideoFade, { label: string; description: string }>;

/** Las opciones del selector, en el orden de L19 (la primera es la de por defecto). */
export const FADES = (['loop', 'black', 'none'] as const).map((value) => ({ value, ...FADE_TEXT[value] }));

export const FADE_DURATIONS: readonly { seconds: FadeSeconds; label: string }[] = [
  { seconds: 0.5, label: 'Corto' },
  { seconds: 1, label: 'Medio' },
  { seconds: 2, label: 'Largo' },
];

const DEFAULT_FADE = { fade: 'loop', fadeSeconds: 1 } as const satisfies Pick<VideoEdit, 'fade' | 'fadeSeconds'>;

// Al mover el fin o el fundido, la vista previa salta a este margen antes de la transición para mostrarla ya.
const TRANSITION_LEAD_SECONDS = 1;

const toTenths = (seconds: number): number => Math.round(seconds * 10);
// Sin ±Infinity (Home/End) ni restos de coma flotante (0,1 + 0,2): todo valor visible es una décima exacta.
const roundTenth = (seconds: number): number => (Number.isFinite(seconds) ? toTenths(seconds) / 10 : seconds);
// El fin por defecto y el tope nunca pasan del final real del video (7,46 s → 7,4 s); el épsilon absorbe 16,1 × 10.
const floorTenth = (seconds: number): number => Math.floor(seconds * 10 + 1e-6) / 10;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const clamp01 = (value: number): number => clamp(value, 0, 1);

const amount = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const handleValue = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Segundos como los muestran las manijas y los campos: siempre una décima ("2,0"). */
export const formatSeconds = (seconds: number): string => handleValue.format(seconds);

/** Duración de fundido como la dicen las opciones ("0,5 s", "1 s"). */
export const fadeDurationLabel = (seconds: number): string => `${amount.format(seconds)} s`;

/** Posición en el video, m:ss y la décima solo si la hay ("0:02", "0:02,5"). */
export function formatClock(seconds: number): string {
  const tenths = toTenths(seconds);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const tenth = rest % 10;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, '0')}${tenth ? `,${tenth}` : ''}`;
}

/** Lo que escribe el usuario en los campos de inicio y fin: acepta coma o punto. */
export function parseSeconds(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}

/** Lo único que el recorte no arregla (el tamaño se chequea antes, con la regla del hero). */
export function checkVideoDuration(durationSeconds: number): string | null {
  return durationSeconds < VIDEO_DURATION.minSeconds
    ? `Dura ${amount.format(durationSeconds)} s: el mínimo es ${VIDEO_DURATION.minSeconds} s.`
    : null;
}

/** Hasta dónde llega cada manija. Cualquier valor adentro es alcanzable porque la otra manija acompaña. */
export function trimBounds(durationSeconds: number) {
  const maxEnd = floorTenth(durationSeconds);
  return {
    start: { min: 0, max: roundTenth(maxEnd - VIDEO_DURATION.minSeconds) },
    end: { min: VIDEO_DURATION.minSeconds, max: maxEnd },
  };
}

/** Los primeros min(duración, 15) s con el fundido por defecto de L19 (loop perfecto de 1 s). */
export function defaultEdit(durationSeconds: number): VideoEdit {
  return { trimStart: 0, trimEnd: Math.min(floorTenth(durationSeconds), VIDEO_DURATION.maxSeconds), ...DEFAULT_FADE };
}

/** Mueve el inicio; el fin acompaña para que el tramo siga entre 1 y 15 s y dentro del video. */
export function moveTrimStart(edit: VideoEdit, seconds: number, durationSeconds: number): VideoEdit {
  const { start, end } = trimBounds(durationSeconds);
  const trimStart = clamp(roundTenth(seconds), start.min, start.max);
  const trimEnd = clamp(
    edit.trimEnd,
    trimStart + VIDEO_DURATION.minSeconds,
    Math.min(trimStart + VIDEO_DURATION.maxSeconds, end.max),
  );
  return { ...edit, trimStart, trimEnd: roundTenth(trimEnd) };
}

/** Mueve el fin; el inicio acompaña (así se puede llevar el tramo más adelante moviendo solo el fin). */
export function moveTrimEnd(edit: VideoEdit, seconds: number, durationSeconds: number): VideoEdit {
  const { start, end } = trimBounds(durationSeconds);
  const trimEnd = clamp(roundTenth(seconds), end.min, end.max);
  const trimStart = clamp(
    edit.trimStart,
    Math.max(start.min, trimEnd - VIDEO_DURATION.maxSeconds),
    trimEnd - VIDEO_DURATION.minSeconds,
  );
  return { ...edit, trimStart: roundTenth(trimStart), trimEnd };
}

/**
 * Valor al que apunta una tecla sobre una manija (patrón slider de WAI-ARIA), o `null` si la tecla no es suya.
 * Home/End devuelven ±Infinity: el move lo acota al tope de esa manija.
 */
export function sliderKeyValue(key: string, shiftKey: boolean, value: number): number | null {
  const arrow = shiftKey ? TIME_STEP.coarse : TIME_STEP.fine;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return roundTenth(value + arrow);
    case 'ArrowLeft':
    case 'ArrowDown':
      return roundTenth(value - arrow);
    case 'PageUp':
      return roundTenth(value + TIME_STEP.coarse);
    case 'PageDown':
      return roundTenth(value - TIME_STEP.coarse);
    case 'Home':
      return Number.NEGATIVE_INFINITY;
    case 'End':
      return Number.POSITIVE_INFINITY;
    default:
      return null;
  }
}

export const selectionSeconds = ({ trimStart, trimEnd }: VideoEdit): number => roundTenth(trimEnd - trimStart);

// Por qué un fundido necesita el doble de su duración, según el tipo (S15: el usuario elige y tiene que entenderlo).
const FADE_NEEDS: Record<Exclude<VideoFade, 'none'>, (seconds: string) => string> = {
  black: (seconds) => `entra en ${seconds} desde negro y sale en ${seconds} a negro`,
  loop: (seconds) => `el final se funde con el principio, ${seconds} de cada lado`,
};

/** El mismo orden y los mismos límites que la API (L19); `null` = se puede subir. */
export function validateEdit(edit: VideoEdit, durationSeconds: number): string | null {
  const length = selectionSeconds(edit);
  if (length < VIDEO_DURATION.minSeconds) {
    return `El tramo dura ${amount.format(length)} s: el mínimo es ${VIDEO_DURATION.minSeconds} s.`;
  }
  if (length > VIDEO_DURATION.maxSeconds) {
    return `El tramo dura ${amount.format(length)} s: el máximo es ${VIDEO_DURATION.maxSeconds} s.`;
  }
  if (edit.trimStart < 0 || edit.trimEnd > durationSeconds) {
    return `El tramo tiene que estar dentro del video (0 a ${amount.format(durationSeconds)} s).`;
  }
  if (edit.fade !== 'none' && edit.fadeSeconds * 2 > length) {
    const seconds = fadeDurationLabel(edit.fadeSeconds);
    return (
      `Un fundido de ${seconds} necesita un tramo de al menos ${fadeDurationLabel(edit.fadeSeconds * 2)}: ` +
      `${FADE_NEEDS[edit.fade](seconds)}. Este dura ${amount.format(length)} s; alargalo o elegí un fundido más corto.`
    );
  }
  return null;
}

/** El chip de un video procesado: "0:02–0:15 · Loop perfecto 1 s". */
export function editSummary(edit: VideoEdit): string {
  const { label } = FADE_TEXT[edit.fade];
  const fade = edit.fade === 'none' ? label : `${label} ${fadeDurationLabel(edit.fadeSeconds)}`;
  return `${formatClock(edit.trimStart)}–${formatClock(edit.trimEnd)} · ${fade}`;
}

/** Lo que se muestra en lugar de animar el fundido cuando el sistema pide reducir el movimiento. */
export function fadeExplanation(edit: VideoEdit): string {
  const { label, description } = FADE_TEXT[edit.fade];
  const title = edit.fade === 'none' ? label : `${label} (${fadeDurationLabel(edit.fadeSeconds)})`;
  return `${title}. ${description}`;
}

/*
 * Vista previa aproximada en el navegador (L19). El resultado real lo arma ffmpeg; esto solo da una idea:
 * - black: una capa negra encima cuya opacidad baja de 1 a 0 al empezar y sube de 0 a 1 al terminar.
 * - loop: un segundo <video> encima que arranca en el inicio del tramo durante los últimos `fadeSeconds` y va
 *   apareciendo; al llegar al fin, el principal salta a donde quedó el segundo (inicio + fadeSeconds), igual que la
 *   salida del servidor, que dura tramo − fadeSeconds.
 * - none: nada encima; el principal vuelve al inicio.
 */

export interface PreviewFrame {
  curtainOpacity: number;
  /** El segundo video del loop: dónde tiene que estar y cuánto se ve; `null` = oculto. */
  overlay: { opacity: number; time: number } | null;
}

/** Qué se ve encima del video principal cuando va por el segundo `time`. */
export function previewFrame(time: number, edit: VideoEdit): PreviewFrame {
  const { trimStart, trimEnd, fadeSeconds } = edit;
  if (edit.fade === 'black') {
    const nearestEdge = Math.min(time - trimStart, trimEnd - time);
    return { curtainOpacity: clamp01(1 - nearestEdge / fadeSeconds), overlay: null };
  }
  if (edit.fade === 'loop') {
    const fadeFrom = trimEnd - fadeSeconds;
    if (time < fadeFrom) return { curtainOpacity: 0, overlay: null };
    const elapsed = Math.min(time - fadeFrom, fadeSeconds);
    return { curtainOpacity: 0, overlay: { opacity: clamp01(elapsed / fadeSeconds), time: trimStart + elapsed } };
  }
  return { curtainOpacity: 0, overlay: null };
}

/** Adónde vuelve el video principal al llegar al fin del tramo. */
export const previewLoopStart = (edit: VideoEdit): number =>
  edit.fade === 'loop' ? roundTenth(edit.trimStart + edit.fadeSeconds) : edit.trimStart;

/** Adónde saltar al cambiar el fin o el fundido: un segundo antes de la transición, sin salirse del loop. */
export function endingPreviewTime(edit: VideoEdit): number {
  const transition = edit.fade === 'none' ? edit.trimEnd : edit.trimEnd - edit.fadeSeconds;
  return Math.max(previewLoopStart(edit), roundTenth(transition - TRANSITION_LEAD_SECONDS));
}

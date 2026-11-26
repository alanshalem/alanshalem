import { hline, rect } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import type { Typesetter } from '../type.ts';

/**
 * Piezas comunes de las tarjetas, como en el sitio: superficie con borde de 1px, sin radio ni sombra, y el
 * encabezado de sección (label a la izquierda, aclaración a la derecha, regla debajo). El fondo exterior queda
 * transparente: la tarjeta trae su propia superficie y se lee igual en el tema claro y el oscuro de GitHub.
 */

/** Rectángulo con borde de 1px nítido (el trazo va centrado en el borde, por eso el medio píxel). */
export const box = (x: number, y: number, width: number, height: number, fill: string = color.surfaceAlt): string =>
  rect(x + 0.5, y + 0.5, width - 1, height - 1, `fill="${fill}" stroke="${color.border}"`);

/** La tarjeta entera. */
export const frame = (width: number, height: number, fill: string = color.surface): string => box(0, 0, width, height, fill);

/** Cuadradito de acento que encabeza un ítem (features del proyecto, tecnologías de este blog). */
export const MARKER = 6;
export const marker = (x: number, y: number): string => rect(x, y, MARKER, MARKER, `fill="${color.accent}"`);

/** Línea base del label del encabezado y primera y libre debajo de su regla. */
export const HEADER_BASELINE = 38;
export const CONTENT_TOP = 66;

export function sectionHeader(t: Typesetter, width: number, label: string, aside = ''): string {
  const { pad } = layout;
  return [
    t.text(label, pad, HEADER_BASELINE, text.label),
    aside ? t.text(aside, width - pad, HEADER_BASELINE, text.aside, 'end') : '',
    hline(pad, width - pad, HEADER_BASELINE + 12, color.border),
  ].join('');
}

/** Alto común de las tarjetas de media fila (stats y lenguajes van lado a lado y tienen que medir lo mismo). */
export const HALF_HEIGHT = 236;

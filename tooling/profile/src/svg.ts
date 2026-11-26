import type { Typesetter } from './type.ts';
import { escapeXml } from './xml.ts';

/** Primitivas SVG compartidas por todas las tarjetas. */

/** Número corto para atributos: sin ceros de más ni "-0". */
export const num = (value: number, digits = 2): string => String(+value.toFixed(digits) || 0);

export const rect = (x: number, y: number, width: number, height: number, attrs: string): string =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" ${attrs}/>`;

/** Regla de 1px nítida: se corre medio píxel para que no se reparta entre dos filas. */
export const hline = (x1: number, x2: number, y: number, stroke: string): string =>
  `<path d="M${num(x1)} ${num(Math.round(y) + 0.5)}H${num(x2)}" stroke="${stroke}"/>`;

// Sin movimiento si quien mira lo pidió (WCAG 2.3.3); las animaciones son solo de entrada y terminan antes de 5 s.
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

export interface Document {
  width: number;
  height: number;
  /** Nombre accesible corto. */
  title: string;
  /** Todo lo que la imagen dice: el texto está dibujado como trazos y un lector de pantalla solo lee esto. */
  desc: string;
  /** Glifos del texto: se piden al final, cuando el cuerpo ya está armado y no falta ninguno. */
  glyphs: Typesetter;
  /** Otras definiciones (por ejemplo, marcadores de flecha). */
  defs?: string;
  /** CSS de animaciones; si hay, se agrega la regla de movimiento reducido. */
  css?: string;
  body: string;
}

export function svgDocument({ width, height, title, desc, glyphs, defs = '', css = '', body }: Document): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(desc)}</desc>`,
    css ? `<style>${css}${REDUCED_MOTION}</style>` : '',
    `<defs>${defs}${glyphs.defs()}</defs>`,
    body,
    '</svg>\n',
  ].join('');
}

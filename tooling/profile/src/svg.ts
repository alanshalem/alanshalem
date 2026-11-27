import type { Typesetter } from './type.ts';
import { escapeXml } from './xml.ts';

/** SVG primitives shared by every card. */

/** Short number for attributes: no extra zeros and no "-0". */
export const num = (value: number, digits = 2): string => String(+value.toFixed(digits) || 0);

export const rect = (x: number, y: number, width: number, height: number, attrs: string): string =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" ${attrs}/>`;

/** A crisp 1px rule: shifted half a pixel so it does not spread over two pixel rows. */
export const hline = (x1: number, x2: number, y: number, stroke: string): string =>
  `<path d="M${num(x1)} ${num(Math.round(y) + 0.5)}H${num(x2)}" stroke="${stroke}"/>`;

// No motion when the viewer asked for it (WCAG 2.3.3); animations only play on entry and end within 5 s.
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

export interface Document {
  width: number;
  height: number;
  /** Short accessible name. */
  title: string;
  /** Everything the image says: the text is drawn as outlines and a screen reader only reads this. */
  desc: string;
  /** Text glyphs: requested at the end, once the body is built and none is missing. */
  glyphs: Typesetter;
  /** Other definitions (for example, arrow markers). */
  defs?: string;
  /** Animation CSS; when present, the reduced-motion rule is added. */
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

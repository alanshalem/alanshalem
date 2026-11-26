import gloock from '../fonts/gloock.json' with { type: 'json' };
import hanken400 from '../fonts/hanken-400.json' with { type: 'json' };
import hanken600 from '../fonts/hanken-600.json' with { type: 'json' };
import pagella from '../fonts/pagella.json' with { type: 'json' };
import { num } from './svg.ts';

/**
 * Texto dibujado como trazos. GitHub muestra las imágenes del README como <img>, donde un SVG no carga fuentes web
 * y las del sistema cambian según quien mire: con los glifos de las fuentes del sitio (fonts/, ver LICENSES.txt)
 * la tipografía sale igual en todos lados. Cada glifo se define una vez por SVG y cada letra es un <use>.
 */

interface Font {
  unitsPerEm: number;
  glyphs: Record<string, { a: number; d: string }>;
  /** Kerning por par de caracteres ("AV"), en unidades de la fuente. */
  kern: Record<string, number>;
}

/** Roles del sistema de diseño → glifos. La letra es el prefijo de los ids de esa cara en el SVG. */
const FACES = {
  display: { id: 'd', font: gloock as Font },
  reading: { id: 'r', font: pagella as Font },
  ui: { id: 'u', font: hanken400 as Font },
  uiStrong: { id: 's', font: hanken600 as Font },
} as const;

export type FaceName = keyof typeof FACES;

export interface TextStyle {
  face: FaceName;
  /** px */
  size: number;
  fill: string;
  /** Espacio extra entre letras, en em (como `letter-spacing`). */
  tracking?: number;
  /** Como `text-transform: uppercase`: el texto se escribe normal y el estilo decide cómo se ve. */
  uppercase?: boolean;
}

export type Anchor = 'start' | 'middle' | 'end';

// Fuera del juego de glifos (fonts/extract-glyphs.py) se dibuja "?": visible, en vez de un hueco que pase inadvertido.
const glyphOf = (font: Font, ch: string): string => (font.glyphs[ch] ? ch : '?');

/** Posición x (en unidades de la fuente) de cada carácter y el ancho total. */
function layoutUnits(content: string, style: TextStyle): { chars: string[]; xs: number[]; width: number } {
  const { font } = FACES[style.face];
  const track = (style.tracking ?? 0) * font.unitsPerEm;
  const chars = [...(style.uppercase ? content.toUpperCase() : content)].map((ch) => glyphOf(font, ch));
  const xs: number[] = [];
  let pen = 0;
  chars.forEach((ch, i) => {
    if (i > 0) pen += track + (font.kern[chars[i - 1]! + ch] ?? 0);
    xs.push(pen);
    pen += font.glyphs[ch]!.a;
  });
  return { chars, xs, width: pen };
}

/** Ancho en px. El tracking va entre letras y no después de la última, para que centrar y alinear sea exacto. */
export function measure(content: string, style: TextStyle): number {
  return (layoutUnits(content, style).width * style.size) / FACES[style.face].font.unitsPerEm;
}

/** Corta en palabras sin pasar de `width`; una palabra más ancha que la línea queda sola. */
export function wrap(content: string, style: TextStyle, width: number): string[] {
  const lines: string[] = [];
  for (const word of content.split(/\s+/).filter(Boolean)) {
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (lines.length && measure(candidate, style) <= width) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines;
}

/** Junta los glifos que usa un SVG para definirlos una sola vez en su <defs>. */
export function createTypesetter() {
  const used = new Map<string, string>();
  return {
    /** Una línea de texto con la línea base en `y`. */
    text(content: string, x: number, y: number, style: TextStyle, anchor: Anchor = 'start'): string {
      const { id, font } = FACES[style.face];
      const { chars, xs, width } = layoutUnits(content, style);
      const scale = style.size / font.unitsPerEm;
      const left = x - (anchor === 'start' ? 0 : anchor === 'middle' ? width / 2 : width) * scale;
      const uses = chars.flatMap((ch, i) => {
        const { d } = font.glyphs[ch]!;
        if (!d) return []; // espacios: avanzan pero no se dibujan
        const glyphId = `${id}${ch.codePointAt(0)!.toString(36)}`;
        used.set(glyphId, d);
        return [`<use href="#${glyphId}" x="${xs[i]}"/>`];
      });
      if (uses.length === 0) return '';
      return `<g fill="${style.fill}" transform="translate(${num(left)} ${num(y)}) scale(${num(scale, 5)})">${uses.join('')}</g>`;
    },
    defs(): string {
      return [...used].map(([glyphId, d]) => `<path id="${glyphId}" d="${d}"/>`).join('');
    },
  };
}

export type Typesetter = ReturnType<typeof createTypesetter>;

import gloock from '../fonts/gloock.json' with { type: 'json' };
import hanken400 from '../fonts/hanken-400.json' with { type: 'json' };
import hanken600 from '../fonts/hanken-600.json' with { type: 'json' };
import pagella from '../fonts/pagella.json' with { type: 'json' };
import { num } from './svg.ts';

/**
 * Text drawn as outlines. GitHub shows README images as <img>, where an SVG loads no web fonts and system fonts vary
 * by viewer: with the glyphs of the site's fonts (fonts/, see LICENSES.txt) the type looks the same everywhere. Each
 * glyph is defined once per SVG and each letter is a <use>.
 */

interface Font {
  unitsPerEm: number;
  glyphs: Record<string, { a: number; d: string }>;
  /** Kerning per character pair ("AV"), in font units. */
  kern: Record<string, number>;
}

/** Design system roles → glyphs. The letter prefixes the ids of that face in the SVG. */
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
  /** Extra space between letters, in em (like `letter-spacing`). */
  tracking?: number;
  /** Like `text-transform: uppercase`: the text is written normally and the style decides how it looks. */
  uppercase?: boolean;
}

export type Anchor = 'start' | 'middle' | 'end';

// Outside the glyph set (fonts/extract-glyphs.py) a "?" is drawn: visible, instead of a gap that goes unnoticed.
const glyphOf = (font: Font, ch: string): string => (font.glyphs[ch] ? ch : '?');

/** The x position (in font units) of each character and the total width. */
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

/** Width in px. Tracking goes between letters and not after the last one, so centering and aligning are exact. */
export function measure(content: string, style: TextStyle): number {
  return (layoutUnits(content, style).width * style.size) / FACES[style.face].font.unitsPerEm;
}

/** Wraps at words without exceeding `width`; a word wider than the line stays alone. */
export function wrap(content: string, style: TextStyle, width: number): string[] {
  const lines: string[] = [];
  for (const word of content.split(/\s+/).filter(Boolean)) {
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (lines.length && measure(candidate, style) <= width) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines;
}

/** Collects the glyphs an SVG uses to define each one once in its <defs>. */
export function createTypesetter() {
  const used = new Map<string, string>();
  return {
    /** One line of text with its baseline at `y`. */
    text(content: string, x: number, y: number, style: TextStyle, anchor: Anchor = 'start'): string {
      const { id, font } = FACES[style.face];
      const { chars, xs, width } = layoutUnits(content, style);
      const scale = style.size / font.unitsPerEm;
      const left = x - (anchor === 'start' ? 0 : anchor === 'middle' ? width / 2 : width) * scale;
      const uses = chars.flatMap((ch, i) => {
        const { d } = font.glyphs[ch]!;
        if (!d) return []; // spaces: they advance but are not drawn
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

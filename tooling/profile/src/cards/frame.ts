import { hline, rect } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import type { Typesetter } from '../type.ts';

/**
 * Pieces shared by the cards, as on the site: a surface with a 1px border, no radius or shadow, and the section header
 * (label on the left, aside on the right, rule below). The outer background stays transparent: the card brings its
 * own surface and reads the same in GitHub's light and dark themes.
 */

/** A rectangle with a crisp 1px border (the stroke is centered on the edge, hence the half pixel). */
export const box = (x: number, y: number, width: number, height: number, fill: string = color.surfaceAlt): string =>
  rect(x + 0.5, y + 0.5, width - 1, height - 1, `fill="${fill}" stroke="${color.border}"`);

/** The whole card. */
export const frame = (width: number, height: number, fill: string = color.surface): string => box(0, 0, width, height, fill);

/** Small accent square that leads an item (project features, this blog's technologies). */
export const MARKER = 6;
export const marker = (x: number, y: number): string => rect(x, y, MARKER, MARKER, `fill="${color.accent}"`);

/** Baseline of the header label, and the first free y below its rule. */
export const HEADER_BASELINE = 38;
/** The rule under the section header: content that hangs from it (the stats rows) starts here. */
export const HEADER_RULE = HEADER_BASELINE + 12;
export const CONTENT_TOP = 66;

export function sectionHeader(t: Typesetter, width: number, label: string, aside = ''): string {
  const { pad } = layout;
  return [
    t.text(label, pad, HEADER_BASELINE, text.label),
    aside ? t.text(aside, width - pad, HEADER_BASELINE, text.aside, 'end') : '',
    hline(pad, width - pad, HEADER_RULE, color.border),
  ].join('');
}

/** Shared height of the half-row cards (stats and languages sit side by side and must match). */
export const HALF_HEIGHT = 236;

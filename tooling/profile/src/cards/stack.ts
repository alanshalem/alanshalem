import { stack, type Tech } from '../content.ts';
import { hline, svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter, measure, type Typesetter } from '../type.ts';
import { box, CONTENT_TOP, frame, HEADER_BASELINE, MARKER, marker, sectionHeader } from './frame.ts';

const LABEL_COLUMN = 132;
// Text baseline 18.5 px below the top edge: optically centers Hanken's cap height at 13 px.
const CHIP = { height: 28, baseline: 18.5, padX: 10, gap: 8, markerGap: 7 } as const;
const SECTION_GAP = 16;
const LEGEND = 'Used to build this blog';

const chipWidth = (tech: Tech): number =>
  measure(tech.name, text.body) + 2 * CHIP.padX + (tech.blog ? MARKER + CHIP.markerGap : 0);

function chip(t: Typesetter, tech: Tech, x: number, y: number): string {
  let textX = x + CHIP.padX;
  let parts = box(x, y, chipWidth(tech), CHIP.height);
  if (tech.blog) {
    parts += marker(textX, y + (CHIP.height - MARKER) / 2);
    textX += MARKER + CHIP.markerGap;
  }
  return parts + t.text(tech.name, textX, y + CHIP.baseline, text.body);
}

/** A category's chips in rows that stay within the width; returns the SVG and where it ended. */
function chipRows(t: Typesetter, items: readonly Tech[], left: number, right: number, top: number) {
  let x = left;
  let y = top;
  let svg = '';
  for (const tech of items) {
    const width = chipWidth(tech);
    if (x > left && x + width > right) {
      x = left;
      y += CHIP.height + CHIP.gap;
    }
    svg += chip(t, tech, x, y);
    x += width + CHIP.gap;
  }
  return { svg, bottom: y + CHIP.height };
}

export function renderStack(): string {
  const t = createTypesetter();
  const { width, pad } = layout;
  const legendX = width - pad - measure(LEGEND, text.aside);
  let body = sectionHeader(t, width, 'Tech stack', LEGEND) + marker(legendX - MARKER - CHIP.markerGap, HEADER_BASELINE - 8);

  let top = CONTENT_TOP;
  stack.forEach(({ category, items }, i) => {
    if (i > 0) {
      body += hline(pad, width - pad, top + SECTION_GAP, color.border);
      top += 2 * SECTION_GAP;
    }
    body += t.text(category, pad, top + CHIP.baseline, text.label);
    const rows = chipRows(t, items, pad + LABEL_COLUMN, width - pad, top);
    body += rows.svg;
    top = rows.bottom;
  });
  const height = top + pad;

  const blog = stack.flatMap((s) => s.items.filter((tech) => tech.blog).map((tech) => tech.name));
  return svgDocument({
    width,
    height,
    title: 'Tech stack',
    desc: `${stack.map((s) => `${s.category}: ${s.items.map((tech) => tech.name).join(', ')}.`).join(' ')} Used to build this blog: ${blog.join(', ')}.`,
    glyphs: t,
    body: frame(width, height) + body,
  });
}

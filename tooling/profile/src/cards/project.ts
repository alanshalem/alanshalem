import { project } from '../content.ts';
import { svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter, wrap, type Typesetter } from '../type.ts';
import { box, CONTENT_TOP, frame, MARKER, marker, sectionHeader } from './frame.ts';

const TEXT_WIDTH = 430;
const DIAGRAM_LEFT = 500;
const BOX = { width: 92, height: 30, gapX: 20, gapY: 34 } as const;
const DIAGRAM_TOP = 100;
const LINE = { dek: 22, feature: 24, caption: 17 } as const;

/** Arquitectura del README del proyecto, resumida: [columna, fila, nombre]. */
const BOXES = {
  visitor: [0, 0, 'Visitor'],
  caddy: [1, 0, 'Caddy'],
  site: [2, 0, 'Static HTML'],
  admin: [0, 1, 'Admin'],
  api: [1, 1, '.NET API'],
  builder: [2, 1, 'Builder'],
  db: [1, 2, 'SQLite'],
} as const;
type Box = keyof typeof BOXES;
const ARROWS: ReadonlyArray<[Box, Box]> = [
  ['visitor', 'caddy'], ['caddy', 'site'], ['caddy', 'api'], ['admin', 'api'], ['api', 'builder'], ['builder', 'site'], ['api', 'db'],
];
const CAPTION = 'Visitors only get pre-built HTML; publishing a post rebuilds the site and swaps it atomically.';

const boxX = (col: number): number => DIAGRAM_LEFT + col * (BOX.width + BOX.gapX);
const boxY = (row: number): number => DIAGRAM_TOP + row * (BOX.height + BOX.gapY);

/** Flecha entre los bordes enfrentados de dos cajas vecinas (misma fila o misma columna). */
function arrow([from, to]: [Box, Box]): string {
  const [c1, r1] = BOXES[from];
  const [c2, r2] = BOXES[to];
  const d =
    r1 === r2
      ? `M${boxX(c1) + BOX.width} ${boxY(r1) + BOX.height / 2}H${boxX(c2) - 2}`
      : r2 > r1
        ? `M${boxX(c1) + BOX.width / 2} ${boxY(r1) + BOX.height}V${boxY(r2) - 2}`
        : `M${boxX(c1) + BOX.width / 2} ${boxY(r1)}V${boxY(r2) + BOX.height + 2}`;
  return `<path d="${d}" stroke="${color.textTertiary}" marker-end="url(#arrow)"/>`;
}

function diagram(t: Typesetter): { svg: string; bottom: number } {
  const boxes = Object.values(BOXES)
    .map(([col, row, name]) =>
      box(boxX(col), boxY(row), BOX.width, BOX.height) +
      t.text(name, boxX(col) + BOX.width / 2, boxY(row) + 19.5, text.body, 'middle'),
    )
    .join('');
  const captionTop = boxY(2) + BOX.height + 26;
  const lines = wrap(CAPTION, text.meta, 3 * BOX.width + 2 * BOX.gapX);
  const caption = lines.map((line, i) => t.text(line, DIAGRAM_LEFT, captionTop + i * LINE.caption, text.meta)).join('');
  return {
    svg: t.text('How it works', DIAGRAM_LEFT, DIAGRAM_TOP - 16, text.label) + ARROWS.map(arrow).join('') + boxes + caption,
    bottom: captionTop + (lines.length - 1) * LINE.caption,
  };
}

export function renderProject(): string {
  const t = createTypesetter();
  const { width, pad } = layout;
  let body = sectionHeader(t, width, project.eyebrow, `github.com/${project.repo}`);

  let y = CONTENT_TOP + 32;
  body += t.text(project.title, pad, y, text.title);
  y += 8; // aire entre el título (Gloock) y la bajada, como en las cards del sitio
  for (const line of wrap(project.dek, text.dek, TEXT_WIDTH)) {
    y += LINE.dek;
    body += t.text(line, pad, y, text.dek);
  }
  y += 12;
  for (const feature of project.features) {
    y += LINE.feature;
    body += marker(pad, y - 8) + t.text(feature, pad + MARKER + 10, y, text.body);
  }
  y += 30;
  body += t.text(project.stack, pad, y, text.meta);

  const chart = diagram(t);
  const height = Math.max(y, chart.bottom) + pad;
  const arrowHead = `<marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" fill="${color.textTertiary}"/></marker>`;

  return svgDocument({
    width,
    height,
    title: `${project.eyebrow}: ${project.title}`,
    desc: `${project.title}. ${project.dek} ${project.features.join('. ')}. Stack: ${project.stack}. ${CAPTION}`,
    glyphs: t,
    defs: arrowHead,
    body: frame(width, height) + body + chart.svg,
  });
}

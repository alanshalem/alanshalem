import { person } from '../content.ts';
import { num, svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter } from '../type.ts';
import { frame } from './frame.ts';

const HEIGHT = 230;
const LEFT = 40;

/**
 * Motivo del grafo de ideas del sitio (nodos en los colores dataviz unidos por líneas tenues). Posiciones fijas:
 * es decoración, no datos, y así el SVG no cambia entre corridas.
 */
const NODES: ReadonlyArray<[x: number, y: number, r: number, tone: number]> = [
  [628, 64, 4, 0], [700, 44, 3, 1], [770, 78, 5, 2], [664, 122, 6, 1], [742, 140, 3.5, 0],
  [610, 176, 3, 2], [700, 190, 4.5, 0], [790, 186, 3, 1],
];
const EDGES: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [0, 3], [1, 3], [2, 4], [3, 4], [3, 5], [3, 6], [4, 6], [4, 7], [5, 6],
];

// Entrada escalonada: cada línea sube y aparece; la regla se dibuja; los nodos aparecen al final. Todo dura < 2 s.
const CSS = [
  '.in{animation:rise .8s cubic-bezier(.2,.7,.2,1) both}',
  '.d1{animation-delay:.12s}.d2{animation-delay:.24s}.d3{animation-delay:.36s}',
  '.rule{stroke-dasharray:420;animation:draw 1.1s .3s ease-out both}',
  '.node{animation:fade .9s .6s ease-out both}',
  '@keyframes rise{from{opacity:0;transform:translateY(8px)}}',
  '@keyframes draw{from{stroke-dashoffset:420}}',
  '@keyframes fade{from{opacity:0}}',
].join('');

export function renderHeader(): string {
  const t = createTypesetter();
  const { width } = layout;
  const lines = EDGES.map(([a, b]) => `M${NODES[a]![0]} ${NODES[a]![1]}L${NODES[b]![0]} ${NODES[b]![1]}`).join('');
  const nodes = NODES.map(([x, y, r, tone]) => `<circle cx="${x}" cy="${y}" r="${num(r)}" fill="${color.dataviz[tone]}"/>`).join('');

  const body = [
    frame(width, HEIGHT, color.page),
    `<g class="in">${t.text(person.greeting, LEFT, 58, text.label)}</g>`,
    `<g class="in d1">${t.text(person.name, LEFT, 122, text.name)}</g>`,
    `<g class="in d2">${t.text(person.role, LEFT, 158, text.lead)}</g>`,
    `<path class="rule" d="M${LEFT} 180.5H460" stroke="${color.border}"/>`,
    `<g class="in d3">${t.text(person.bio, LEFT, 204, text.meta)}</g>`,
    `<g class="node"><path d="${lines}" stroke="${color.text}" stroke-opacity=".22"/>${nodes}</g>`,
  ].join('');

  return svgDocument({
    width,
    height: HEIGHT,
    title: `${person.name} — ${person.role}`,
    desc: `${person.greeting} ${person.name}. ${person.role}. ${person.bio}.`,
    glyphs: t,
    css: CSS,
    body,
  });
}

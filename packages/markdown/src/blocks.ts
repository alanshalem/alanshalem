import { escapeHtml } from './escape.ts';
import { plainInline, renderFigure, renderInline, type InlineContext } from './inline.ts';
import { CALLOUT_KINDS, type CalloutKind, type Labels } from './labels.ts';
import type { Heading } from './types.ts';

/**
 * Renderer de bloques: encabezados, párrafos, figuras, listas, citas, cajas destacadas,
 * código, tablas y reglas.
 *
 * Trabaja sobre un arreglo de líneas. Los contenedores (citas, ítems de lista) le quitan
 * su prefijo a las líneas y se llaman a sí mismos de forma recursiva.
 * Las definiciones de notas al pie se sacan antes (footnotes.ts): acá ya no llegan.
 * No soporta: HTML crudo, encabezados setext (subrayados con === / ---).
 */

export interface BlockContext {
  headings: Heading[];
  slugger: (text: string) => string;
  headingOffset: number;
  /** Profundidad de anidamiento: protege contra entradas que intenten desbordar la pila. */
  depth: number;
  /** En listas "apretadas" los párrafos de los ítems no llevan <p>. */
  tight: boolean;
  inline: InlineContext;
  labels: Labels;
  /** Opción `figures`: imagen sola con título => <figure>. */
  figures: boolean;
}

const MAX_DEPTH = 16;

export const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SAFE_LANGUAGE = /^[\w+#.-]{1,30}$/;
// Marcador de caja estilo GitHub: solo en la primera línea de la cita, sin texto al lado.
const CALLOUT_MARKER = new RegExp(`^\\[!(${CALLOUT_KINDS.join('|')})\\][ \\t]*$`, 'i');

const isBlank = (line: string): boolean => line.trim() === '';

/** Ancho de la sangría; un tab cuenta hasta el próximo múltiplo de 4. */
function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Quita hasta `count` columnas de sangría del comienzo de la línea. */
function stripIndent(line: string, count: number): string {
  let width = 0;
  let index = 0;
  while (index < line.length && width < count) {
    const char = line[index];
    if (char === ' ') {
      width += 1;
      index += 1;
    } else if (char === '\t') {
      const tabWidth = 4 - (width % 4);
      if (width + tabWidth > count) return ' '.repeat(width + tabWidth - count) + line.slice(index + 1);
      width += tabWidth;
      index += 1;
    } else {
      break;
    }
  }
  return line.slice(index);
}

/** ¿Esta línea cierra el bloque de código abierto con `fence`? Un cierre más largo también cierra. */
export function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return (
    indentOf(line) <= 3 && trimmed.length >= fence.length && trimmed[0] === fence[0] && /^(`+|~+)$/.test(trimmed)
  );
}

/** ¿Esta línea abre un bloque nuevo? Sirve para saber cuándo termina un párrafo. */
function startsBlock(line: string): boolean {
  if (FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || BLOCKQUOTE.test(line)) return true;
  const item = LIST_ITEM.exec(line);
  if (!item) return false;
  const hasContent = line.slice(item[0].length).trim() !== '';
  const marker = item[2] ?? '';
  const ordered = /\d/.test(marker);
  // Una lista numerada solo interrumpe un párrafo si empieza en 1 ("2024. fue un gran año").
  return hasContent && (!ordered || parseInt(marker, 10) === 1);
}

export function renderBlocks(lines: string[], ctx: BlockContext): string {
  if (ctx.depth > MAX_DEPTH) return `<p>${escapeHtml(lines.join('\n'))}</p>`;

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const result = parseFence(lines, i, fence);
      out.push(result.html);
      i = result.next;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(renderHeading(heading, ctx));
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const result = parseBlockquote(lines, i, ctx);
      out.push(result.html);
      i = result.next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const result = parseList(lines, i, ctx);
      out.push(result.html);
      i = result.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const result = parseTable(lines, i, ctx);
      out.push(result.html);
      i = result.next;
      continue;
    }

    const result = parseParagraph(lines, i, ctx);
    out.push(result.html);
    i = result.next;
  }

  return out.join('\n');
}

/* ------------------------------ Código ------------------------------ */

function parseFence(lines: string[], start: number, open: RegExpExecArray): { html: string; next: number } {
  const fence = open[1] ?? '```';
  const language = open[2] ?? '';
  const code: string[] = [];
  const openIndent = indentOf(lines[start] ?? '');

  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (closesFence(line, fence)) {
      i += 1;
      break;
    }
    code.push(stripIndent(line, openIndent));
    i += 1;
  }

  const classAttr = SAFE_LANGUAGE.test(language) ? ` class="language-${escapeHtml(language)}"` : '';
  return { html: `<pre><code${classAttr}>${escapeHtml(code.join('\n'))}</code></pre>`, next: i };
}

/* ---------------------------- Encabezados ---------------------------- */

function renderHeading(match: RegExpExecArray, ctx: BlockContext): string {
  const level = Math.min(6, (match[1] ?? '#').length + ctx.headingOffset);
  // Se quitan los # de cierre ("## Título ##"); un "#" suelto cuenta como título vacío.
  const raw = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+[ \t]*$/, '').trim();

  // Solo los encabezados de primer nivel de documento reciben ancla y entran al índice.
  if (ctx.depth > 0) return `<h${level}>${renderInline(raw, ctx.inline)}</h${level}>`;

  const text = plainInline(raw);
  const id = ctx.slugger(text);
  ctx.headings.push({ level, id, text });
  return `<h${level} id="${id}">${renderInline(raw, ctx.inline)}</h${level}>`;
}

/* ------------------------------ Párrafos ------------------------------ */

function parseParagraph(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const collected: string[] = [lines[start] ?? ''];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line) || startsBlock(line)) break;
    collected.push(line);
    i += 1;
  }

  const text = collected
    .map((line) => line.replace(/^[ \t]+/, ''))
    .join('\n')
    .replace(/[ \t]+$/, '');
  const figure = ctx.figures ? renderFigure(text, ctx.inline) : null;
  if (figure) return { html: figure, next: i };
  const inline = renderInline(text, ctx.inline);
  return { html: ctx.tight ? inline : `<p>${inline}</p>`, next: i };
}

/* ------------------------------- Citas ------------------------------- */

function parseBlockquote(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const inner: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (BLOCKQUOTE.test(line)) {
      inner.push(line.replace(/^ {0,3}> ?/, ''));
    } else {
      // Continuación "perezosa": una línea de texto pegada a la cita sigue siendo parte del párrafo.
      const previous = inner[inner.length - 1];
      const canContinue = !isBlank(line) && !startsBlock(line) && previous !== undefined && !isBlank(previous);
      if (!canContinue) break;
      inner.push(line);
    }
    i += 1;
  }

  const innerCtx: BlockContext = { ...ctx, depth: ctx.depth + 1, tight: false };
  const marker = CALLOUT_MARKER.exec(inner[0] ?? '')?.[1]?.toLowerCase();
  const kind = CALLOUT_KINDS.find((candidate) => candidate === marker);
  if (kind) return { html: renderCallout(kind, renderBlocks(inner.slice(1), innerCtx), ctx.labels), next: i };

  const body = renderBlocks(inner, innerCtx);
  return { html: `<blockquote>\n${body}\n</blockquote>`, next: i };
}

/** Caja destacada: <aside> porque es contenido complementario, no una cita de otra persona. */
function renderCallout(kind: CalloutKind, body: string, labels: Labels): string {
  const title = `<p class="callout-title">${escapeHtml(labels[kind])}</p>`;
  return `<aside class="callout callout-${kind}">\n${body ? `${title}\n${body}` : title}\n</aside>`;
}

/* ------------------------------- Listas ------------------------------- */

function parseList(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const firstMarker = first?.[2] ?? '-';
  const ordered = /\d/.test(firstMarker);
  const markerKind = ordered ? firstMarker.slice(-1) : firstMarker; // '.' o ')' ; '-', '*' o '+'
  const startNumber = ordered ? parseInt(firstMarker, 10) : 1;

  const isSibling = (line: string): boolean => {
    const match = LIST_ITEM.exec(line);
    if (!match) return false;
    const marker = match[2] ?? '';
    return /\d/.test(marker) === ordered && (ordered ? marker.slice(-1) : marker) === markerKind;
  };

  const items: string[][] = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = LIST_ITEM.exec(line);
    if (!match) break;

    const markerWidth = (match[1] ?? '').length + (match[2] ?? '').length;
    const spaces = (match[3] ?? '').replace(/\t/g, '    ').length;
    const rest = line.slice(match[0].length);
    // Ítem vacío o con 5+ espacios (código indentado): el contenido arranca 1 espacio después del marcador.
    const contentIndent = markerWidth + (spaces === 0 || spaces >= 5 ? 1 : spaces);
    const firstContent = spaces >= 5 ? ' '.repeat(spaces - 1) + rest : rest;

    const itemLines: string[] = [firstContent];
    i += 1;

    while (i < lines.length) {
      const current = lines[i] ?? '';

      if (isBlank(current)) {
        // Una línea en blanco sigue dentro del ítem solo si lo próximo está indentado.
        let k = i;
        while (k < lines.length && isBlank(lines[k] ?? '')) k += 1;
        if (k < lines.length && indentOf(lines[k] ?? '') >= contentIndent) {
          for (; i < k; i += 1) itemLines.push('');
          loose = true; // bloques separados por línea en blanco dentro del ítem
          continue;
        }
        break;
      }

      if (indentOf(current) >= contentIndent) {
        itemLines.push(stripIndent(current, contentIndent));
        i += 1;
        continue;
      }

      // Continuación perezosa de un párrafo.
      const previous = itemLines[itemLines.length - 1] ?? '';
      if (!isBlank(previous) && !startsBlock(current) && !LIST_ITEM.test(current)) {
        itemLines.push(current.replace(/^[ \t]+/, ''));
        i += 1;
        continue;
      }
      break;
    }

    items.push(itemLines);

    // ¿Sigue otro ítem hermano? Si hubo líneas en blanco entre medio, la lista es "suelta".
    let k = i;
    while (k < lines.length && isBlank(lines[k] ?? '')) k += 1;
    if (k < lines.length && isSibling(lines[k] ?? '')) {
      if (k > i) loose = true;
      i = k;
      continue;
    }
    break;
  }

  const itemCtx: BlockContext = { ...ctx, depth: ctx.depth + 1, tight: !loose };
  const body = items
    .map((itemLines) => `<li>${renderBlocks(itemLines, itemCtx)}</li>`)
    .join('\n');

  const html = ordered
    ? `<ol${startNumber !== 1 ? ` start="${startNumber}"` : ''}>\n${body}\n</ol>`
    : `<ul>\n${body}\n</ul>`;
  return { html, next: i };
}

/* ------------------------------- Tablas ------------------------------- */

/** Parte una fila en celdas; `\|` es un pipe literal. */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (char === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableStart(lines: string[], i: number): boolean {
  const header = lines[i] ?? '';
  const delimiter = lines[i + 1];
  if (delimiter === undefined || !header.includes('|') || !TABLE_DELIMITER.test(delimiter)) return false;
  return splitRow(header).length === splitRow(delimiter).length;
}

type Align = 'left' | 'center' | 'right' | null;

function parseAlign(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function parseTable(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const headerCells = splitRow(lines[start] ?? '');
  const aligns = splitRow(lines[start + 1] ?? '').map(parseAlign);

  const cell = (tag: 'th' | 'td', content: string, column: number): string => {
    const align = aligns[column];
    const cls = align && align !== 'left' ? ` class="align-${align}"` : '';
    return `<${tag}${cls}>${renderInline(content, ctx.inline)}</${tag}>`;
  };

  const head = `<tr>${headerCells.map((c, column) => cell('th', c, column)).join('')}</tr>`;

  const rows: string[] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line) || FENCE_OPEN.test(line) || HEADING.test(line) || BLOCKQUOTE.test(line)) break;
    const cells = splitRow(line);
    // Filas con menos celdas se completan; las que sobran se descartan.
    const normalized = headerCells.map((_, column) => cells[column] ?? '');
    rows.push(`<tr>${normalized.map((c, column) => cell('td', c, column)).join('')}</tr>`);
    i += 1;
  }

  const body = rows.length > 0 ? `\n<tbody>\n${rows.join('\n')}\n</tbody>` : '';
  const html = `<div class="table-wrap"><table>\n<thead>\n${head}\n</thead>${body}\n</table></div>`;
  return { html, next: i };
}

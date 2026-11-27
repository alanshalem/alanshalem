import { escapeHtml } from './escape.ts';
import { plainInline, renderFigure, renderInline, type InlineContext } from './inline.ts';
import { CALLOUT_KINDS, type CalloutKind, type Labels } from './labels.ts';
import type { Heading } from './types.ts';

/**
 * Block renderer: headings, paragraphs, figures, lists, quotes, callouts, code, tables and rules.
 *
 * Works on an array of lines. Containers (quotes, list items) strip their prefix from the lines and call
 * themselves recursively.
 * Footnote definitions are taken out before (footnotes.ts): they never reach this point.
 * Not supported: raw HTML, setext headings (underlined with === / ---).
 */

export interface BlockContext {
  headings: Heading[];
  slugger: (text: string) => string;
  headingOffset: number;
  /** Minimum heading level (the `minHeadingLevel` option, already clamped to 1..6). */
  minHeadingLevel: number;
  /** Nesting depth: guards against input that tries to overflow the stack. */
  depth: number;
  /** In "tight" lists the item paragraphs get no <p>. */
  tight: boolean;
  inline: InlineContext;
  labels: Labels;
  /** The `figures` option: a lone image with a title => <figure>. */
  figures: boolean;
  /** Collects the line where each top-level block starts (`RenderResult.blockStarts`). */
  blockStarts: number[];
}

const MAX_DEPTH = 16;

export const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SAFE_LANGUAGE = /^[\w+#.-]{1,30}$/;
// GitHub-style callout marker: only on the first line of the quote, with nothing else on it.
const CALLOUT_MARKER = new RegExp(`^\\[!(${CALLOUT_KINDS.join('|')})\\][ \\t]*$`, 'i');

const isBlank = (line: string): boolean => line.trim() === '';

/** Indentation width; a tab counts up to the next multiple of 4. */
function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Strips up to `count` columns of indentation from the start of the line. */
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

/** Does this line close the code block opened with `fence`? A longer closing fence closes it too. */
export function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return (
    indentOf(line) <= 3 && trimmed.length >= fence.length && trimmed[0] === fence[0] && /^(`+|~+)$/.test(trimmed)
  );
}

/** Does this line open a new block? Tells where a paragraph ends. */
function startsBlock(line: string): boolean {
  if (FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || BLOCKQUOTE.test(line)) return true;
  const item = LIST_ITEM.exec(line);
  if (!item) return false;
  const hasContent = line.slice(item[0].length).trim() !== '';
  const marker = item[2] ?? '';
  const ordered = /\d/.test(marker);
  // An ordered list only interrupts a paragraph when it starts at 1 ("2024. was a great year").
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
    // Each pass below adds exactly one element to the HTML: at the top level, one per block.
    if (ctx.depth === 0) ctx.blockStarts.push(i);

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

/* ------------------------------- Code ------------------------------- */

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
  // A long line scrolls horizontally: tabindex makes it keyboard scrollable (WCAG 2.1.1).
  return { html: `<pre tabindex="0"><code${classAttr}>${escapeHtml(code.join('\n'))}</code></pre>`, next: i };
}

/* ------------------------------ Headings ----------------------------- */

function renderHeading(match: RegExpExecArray, ctx: BlockContext): string {
  const level = Math.min(6, Math.max(ctx.minHeadingLevel, (match[1] ?? '#').length + ctx.headingOffset));
  // Closing #s are removed ("## Title ##"); a lone "#" counts as an empty title.
  const raw = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+[ \t]*$/, '').trim();

  // Only document-level headings get an anchor and go into the table of contents.
  if (ctx.depth > 0) return `<h${level}>${renderInline(raw, ctx.inline)}</h${level}>`;

  const text = plainInline(raw);
  const id = ctx.slugger(text);
  ctx.headings.push({ level, id, text });
  return `<h${level} id="${id}">${renderInline(raw, ctx.inline)}</h${level}>`;
}

/* ----------------------------- Paragraphs ----------------------------- */

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

/* ------------------------------- Quotes ------------------------------- */

function parseBlockquote(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const inner: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (BLOCKQUOTE.test(line)) {
      inner.push(line.replace(/^ {0,3}> ?/, ''));
    } else {
      // "Lazy" continuation: a text line right after the quote is still part of its paragraph.
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

/** Callout: an <aside> because it is complementary content, not a quote from someone else. */
function renderCallout(kind: CalloutKind, body: string, labels: Labels): string {
  const title = `<p class="callout-title">${escapeHtml(labels[kind])}</p>`;
  return `<aside class="callout callout-${kind}">\n${body ? `${title}\n${body}` : title}\n</aside>`;
}

/* -------------------------------- Lists ------------------------------- */

function parseList(lines: string[], start: number, ctx: BlockContext): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const firstMarker = first?.[2] ?? '-';
  const ordered = /\d/.test(firstMarker);
  const markerKind = ordered ? firstMarker.slice(-1) : firstMarker; // '.' or ')' ; '-', '*' or '+'
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
    // Empty item or 5+ spaces (indented code): the content starts 1 space after the marker.
    const contentIndent = markerWidth + (spaces === 0 || spaces >= 5 ? 1 : spaces);
    const firstContent = spaces >= 5 ? ' '.repeat(spaces - 1) + rest : rest;

    const itemLines: string[] = [firstContent];
    i += 1;

    while (i < lines.length) {
      const current = lines[i] ?? '';

      if (isBlank(current)) {
        // A blank line stays inside the item only when what follows is indented.
        let k = i;
        while (k < lines.length && isBlank(lines[k] ?? '')) k += 1;
        if (k < lines.length && indentOf(lines[k] ?? '') >= contentIndent) {
          for (; i < k; i += 1) itemLines.push('');
          loose = true; // blocks separated by a blank line inside the item
          continue;
        }
        break;
      }

      if (indentOf(current) >= contentIndent) {
        itemLines.push(stripIndent(current, contentIndent));
        i += 1;
        continue;
      }

      // Lazy continuation of a paragraph.
      const previous = itemLines[itemLines.length - 1] ?? '';
      if (!isBlank(previous) && !startsBlock(current) && !LIST_ITEM.test(current)) {
        itemLines.push(current.replace(/^[ \t]+/, ''));
        i += 1;
        continue;
      }
      break;
    }

    items.push(itemLines);

    // Is a sibling item next? If blank lines came in between, the list is "loose".
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

/* ------------------------------- Tables ------------------------------- */

/** Splits a row into cells; `\|` is a literal pipe. */
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
    // Rows with fewer cells are padded; extra cells are dropped.
    const normalized = headerCells.map((_, column) => cells[column] ?? '');
    rows.push(`<tr>${normalized.map((c, column) => cell('td', c, column)).join('')}</tr>`);
    i += 1;
  }

  const body = rows.length > 0 ? `\n<tbody>\n${rows.join('\n')}\n</tbody>` : '';
  // The wrapper scrolls horizontally on mobile: focusable and named for keyboard and screen readers (WCAG 2.1.1).
  const wrap = `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(ctx.labels.table)}">`;
  const html = `${wrap}<table>\n<thead>\n${head}\n</thead>${body}\n</table></div>`;
  return { html, next: i };
}

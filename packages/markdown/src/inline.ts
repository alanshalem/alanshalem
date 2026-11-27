import { escapeHtml } from './escape.ts';
import type { MathSlot } from './math.ts';
import { BARE_URL, isWordChar, smartenText } from './typography.ts';
import { isExternalUrl, sanitizeUrl } from './url.ts';

/**
 * Inline renderer: **bold**, *italic*, ~~strikethrough~~, `code`, [links](url), ![images](url), <autolinks>,
 * footnote references [^id] and, with the `math` option, $TeX$.
 *
 * A simple parser (it does not implement CommonMark's full delimiter algorithm): emphasis closes with a
 * delimiter run of the SAME length as the one that opened it. Predictable, and it covers what blog writing uses.
 */

interface Parsed {
  html: string;
  end: number;
}

/** What the inline renderer needs to know about the document and the options. */
export interface InlineContext {
  smartTypography: boolean;
  /** HTML of the `[^id]` reference, or null when it has no definition (then it stays literal text). */
  footnoteRef: (id: string) => string | null;
  /** With the `math` option: the slot of a formula (math.ts). Null without it, and then `$` is plain text. */
  math: MathSlot | null;
}

// Characters that can start syntax. Everything else is copied, escaped, in one go. `$` only with the math option.
const SPECIAL = /[\\`!\[<*_~\n]/g;
const SPECIAL_WITH_MATH = /[\\`!\[<*_~\n$]/g;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]/y;

export function renderInline(source: string, ctx: InlineContext, insideLink = false): string {
  let html = '';
  let i = 0;
  const special = ctx.math ? SPECIAL_WITH_MATH : SPECIAL;

  while (i < source.length) {
    special.lastIndex = i;
    const match = special.exec(source);
    const next = match ? match.index : source.length;

    if (next > i) {
      const text = source.slice(i, next);
      html += escapeHtml(ctx.smartTypography ? smartenText(text, source[i - 1]) : text);
      i = next;
      continue;
    }

    if (source[i] === '\n') {
      // Two spaces at the end of the line = hard break. Otherwise it is a soft break.
      const hardBreak = html.endsWith('  ');
      html = html.replace(/ +$/, '') + (hardBreak ? '<br>\n' : '\n');
      i += 1;
      continue;
    }

    const parsed = parseSpecial(source, i, ctx, insideLink);
    if (parsed) {
      html += parsed.html;
      i = parsed.end;
    } else {
      html += escapeHtml(source[i] ?? '');
      i += 1;
    }
  }

  return html;
}

/** Text without Markdown marks (for heading ids, image alt text and excerpts). */
export function plainInline(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, '$1')
    .replace(/\[\^[^\]\s]+\]/g, '') // a footnote number is not part of the title
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSpecial(source: string, i: number, ctx: InlineContext, insideLink: boolean): Parsed | null {
  switch (source[i]) {
    case '\\': {
      const next = source[i + 1];
      if (next === '\n') return { html: '<br>\n', end: i + 2 };
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        return { html: escapeHtml(next), end: i + 2 };
      }
      return null;
    }
    case '`':
      return parseCodeSpan(source, i);
    case '!':
      return source[i + 1] === '[' ? parseLinkOrImage(source, i + 1, true, ctx) : null;
    case '[':
      if (insideLink) return null;
      return parseFootnoteRef(source, i, ctx) ?? parseLinkOrImage(source, i, false, ctx);
    case '<': {
      if (insideLink) return null;
      AUTOLINK.lastIndex = i;
      const match = AUTOLINK.exec(source);
      const url = match?.[1] ? sanitizeUrl(match[1]) : null;
      if (!match || !url) return null;
      return { html: renderAnchor(url, escapeHtml(match[1] ?? '')), end: i + match[0].length };
    }
    case '*':
    case '_':
    case '~':
      return parseEmphasis(source, i, ctx, insideLink);
    case '$':
      return ctx.math ? parseMath(source, i, ctx.math) : null;
    default:
      return null;
  }
}

const DOLLAR_RUN = /\$+/y;
const DIGIT = /\d/;
const BARE_URL_AT = new RegExp(BARE_URL.source, 'iy');
const HAS_BARE_URL = new RegExp(BARE_URL.source, 'i');

const dollarRun = (source: string, i: number): number => {
  DOLLAR_RUN.lastIndex = i;
  return DOLLAR_RUN.exec(source)?.[0].length ?? 1;
};

/** The `$` at `i` as a formula (its slot), or the whole `$` run as text. */
function parseMath(source: string, i: number, slot: MathSlot): Parsed {
  const formula = findMath(source, i);
  if (formula) return { html: slot(formula.tex, false), end: formula.end };
  const run = dollarRun(source, i);
  return { html: '$'.repeat(run), end: i + run };
}

/**
 * `$tex$` at `i`, with pandoc's rule so prices stay text: the opening `$` is not followed by whitespace, and the first
 * `$` after it closes only if it is not preceded by whitespace nor followed by a digit (`$5 y $10` is text). `\$` is a
 * literal dollar, outside and inside math. A `$$` run inside a paragraph is text: display math is a block (blocks.ts).
 * The closing `$` is never looked for inside code spans, autolinks, links or bare URLs. Pure: it only finds.
 */
function findMath(source: string, i: number): { tex: string; end: number } | null {
  if (dollarRun(source, i) > 1 || isSpaceOrEdge(source[i + 1]) || insideBareUrl(source, i)) return null;

  let j = i + 1;
  while (j < source.length) {
    const char = source[j];
    if (char === '\\') {
      j += 2;
      continue;
    }
    const skipped = skipLiteralSpan(source, j);
    if (skipped > j) {
      j = skipped;
      continue;
    }
    if (char === '$') {
      const closes = source[j + 1] !== '$' && !isSpaceOrEdge(source[j - 1]) && !DIGIT.test(source[j + 1] ?? '');
      return closes ? { tex: source.slice(i + 1, j), end: j + 1 } : null;
    }
    j += 1;
  }
  return null;
}

/** Is the `$` at `i` part of a bare URL (`https://e.com/$x`)? A URL is one token: look back to the last space. */
function insideBareUrl(source: string, i: number): boolean {
  let start = i;
  while (start > 0 && !/\s/.test(source[start - 1] ?? '')) start -= 1;
  return HAS_BARE_URL.test(source.slice(start, i));
}

/**
 * Where a span whose `$`s are never math ends, if one starts at `j` (a closed code span, an autolink, a link or a
 * bare URL); `j` itself when none does.
 */
function skipLiteralSpan(source: string, j: number): number {
  const char = source[j];
  if (char === '`') {
    const code = parseCodeSpan(source, j);
    return code.html.startsWith('<code>') ? code.end : j;
  }
  if (char === '<') {
    AUTOLINK.lastIndex = j;
    return AUTOLINK.exec(source) ? AUTOLINK.lastIndex : j;
  }
  if (char === '[') return parseLinkTarget(source, j)?.end ?? j;
  if (isSpaceOrEdge(source[j - 1])) {
    BARE_URL_AT.lastIndex = j;
    return BARE_URL_AT.exec(source) ? BARE_URL_AT.lastIndex : j;
  }
  return j;
}

/** `code` with backtick runs of any length. If it never closes, the run is shown literally. */
function parseCodeSpan(source: string, i: number): Parsed {
  let runLength = 0;
  while (source[i + runLength] === '`') runLength += 1;

  let search = i + runLength;
  while (search < source.length) {
    const closeStart = source.indexOf('`', search);
    if (closeStart === -1) break;

    let closeLength = 0;
    while (source[closeStart + closeLength] === '`') closeLength += 1;

    if (closeLength === runLength) {
      let content = source.slice(i + runLength, closeStart).replace(/\n/g, ' ');
      // One space on each side is dropped (lets you write `` `x` ``).
      if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      return { html: `<code>${escapeHtml(content)}</code>`, end: closeStart + closeLength };
    }
    search = closeStart + closeLength;
  }

  return { html: '`'.repeat(runLength), end: i + runLength };
}

/** `[^id]` with a definition. Without one it returns null and the text goes on (stays literal). */
function parseFootnoteRef(source: string, i: number, ctx: InlineContext): Parsed | null {
  if (source[i + 1] !== '^') return null;
  FOOTNOTE_REF.lastIndex = i;
  const match = FOOTNOTE_REF.exec(source);
  const html = match ? ctx.footnoteRef(match[1] ?? '') : null;
  return match && html !== null ? { html, end: i + match[0].length } : null;
}

interface LinkTarget {
  label: string;
  destination: string;
  title: string;
  end: number;
}

/** Parts of `[label](destination "title")`. `start` points at the '['. */
function parseLinkTarget(source: string, start: number): LinkTarget | null {
  // 1) Find the closing ']', honoring nested brackets, escapes and code.
  let depth = 1;
  let j = start + 1;
  while (j < source.length) {
    const char = source[j];
    if (char === '\\') {
      j += 2;
      continue;
    }
    if (char === '`') {
      j = parseCodeSpan(source, j).end;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
    j += 1;
  }
  if (depth !== 0 || source[j + 1] !== '(') return null;

  const label = source.slice(start + 1, j);

  // 2) Destination and optional title.
  let k = j + 2;
  while (source[k] === ' ') k += 1;

  let destination = '';
  if (source[k] === '<') {
    const close = source.indexOf('>', k);
    if (close === -1 || source.slice(k, close).includes('\n')) return null;
    destination = source.slice(k + 1, close);
    k = close + 1;
  } else {
    let parens = 0;
    while (k < source.length) {
      const char = source[k] ?? '';
      if (char === '\\' && ASCII_PUNCTUATION.test(source[k + 1] ?? '')) {
        destination += source[k + 1];
        k += 2;
        continue;
      }
      if (/\s/.test(char)) break;
      if (char === '(') parens += 1;
      if (char === ')') {
        if (parens === 0) break;
        parens -= 1;
      }
      destination += char;
      k += 1;
    }
  }

  while (source[k] === ' ') k += 1;

  let title = '';
  const quote = source[k];
  if (quote === '"' || quote === "'") {
    let close = k + 1;
    while (close < source.length && source[close] !== quote) {
      close += source[close] === '\\' ? 2 : 1;
    }
    if (close >= source.length) return null;
    title = source.slice(k + 1, close).replace(/\\(.)/g, '$1');
    k = close + 1;
    while (source[k] === ' ') k += 1;
  }

  if (source[k] !== ')') return null;
  return { label, destination, title, end: k + 1 };
}

/** `[text](url "title")` or, with isImage, `![alt](url "title")`. `start` points at the '['. */
function parseLinkOrImage(source: string, start: number, isImage: boolean, ctx: InlineContext): Parsed | null {
  const target = parseLinkTarget(source, start);
  if (!target) return null;
  const { label, title, end } = target;

  // An unsafe URL never produces an href/src: only the text is left.
  const url = sanitizeUrl(target.destination);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

  if (isImage) {
    return { html: url ? renderImage(url, label, titleAttr) : escapeHtml(plainInline(label)), end };
  }

  const inner = renderInline(label, ctx, true);
  if (!url) return { html: inner, end };
  return { html: renderAnchor(url, inner, titleAttr), end };
}

/**
 * Figure: the paragraph is ONLY an image with a title and a safe URL. The title becomes the caption (with inline
 * formatting, escaped like all text) and is not repeated as an attribute.
 * Returns null when it does not apply, and the paragraph renders as usual.
 */
export function renderFigure(source: string, ctx: InlineContext): string | null {
  if (!source.startsWith('![')) return null;
  const target = parseLinkTarget(source, 1);
  const caption = target?.title.trim() ?? '';
  if (!target || target.end !== source.length || caption === '') return null;
  const url = sanitizeUrl(target.destination);
  if (!url) return null;
  return `<figure>${renderImage(url, target.label)}<figcaption>${renderInline(caption, ctx)}</figcaption></figure>`;
}

function renderImage(url: string, label: string, titleAttr = ''): string {
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(plainInline(label))}"${titleAttr} loading="lazy" decoding="async">`;
}

function renderAnchor(url: string, innerHtml: string, titleAttr = ''): string {
  const rel = isExternalUrl(url) ? ' rel="noopener noreferrer"' : '';
  return `<a href="${escapeHtml(url)}"${titleAttr}${rel}>${innerHtml}</a>`;
}

const isSpaceOrEdge = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

/** Open/close rules: `_` neither opens nor closes inside a word (snake_case_name stays intact). */
function canOpen(source: string, i: number, length: number, delimiter: string): boolean {
  if (isSpaceOrEdge(source[i + length])) return false;
  if (delimiter === '_' && isWordChar(source[i - 1])) return false;
  return true;
}

function canClose(source: string, i: number, length: number, delimiter: string): boolean {
  if (isSpaceOrEdge(source[i - 1])) return false;
  if (delimiter === '_' && isWordChar(source[i + length])) return false;
  return true;
}

function wrapEmphasis(delimiter: string, length: number, inner: string): string {
  if (delimiter === '~') return `<del>${inner}</del>`;
  if (length === 1) return `<em>${inner}</em>`;
  if (length === 2) return `<strong>${inner}</strong>`;
  return `<em><strong>${inner}</strong></em>`;
}

function parseEmphasis(source: string, i: number, ctx: InlineContext, insideLink: boolean): Parsed | null {
  const delimiter = source[i] ?? '';
  let length = 0;
  while (source[i + length] === delimiter) length += 1;

  // Supported: * and _ in runs of 1 to 3; ~ only in runs of 2 (~~strikethrough~~).
  if (delimiter === '~' ? length !== 2 : length > 3) return null;
  if (!canOpen(source, i, length, delimiter)) return null;

  let j = i + length;
  while (j < source.length) {
    const char = source[j];
    if (char === '\\') {
      j += 2;
      continue;
    }
    if (char === '`') {
      j = parseCodeSpan(source, j).end;
      continue;
    }
    // A formula is one unit: an emphasis delimiter inside it neither closes nor opens anything.
    if (char === '$' && ctx.math) {
      j = findMath(source, j)?.end ?? j + dollarRun(source, j);
      continue;
    }
    if (char === delimiter) {
      let runLength = 0;
      while (source[j + runLength] === delimiter) runLength += 1;
      if (runLength === length && j > i + length && canClose(source, j, length, delimiter)) {
        const inner = renderInline(source.slice(i + length, j), ctx, insideLink);
        return { html: wrapEmphasis(delimiter, length, inner), end: j + length };
      }
      j += runLength;
      continue;
    }
    j += 1;
  }
  return null;
}

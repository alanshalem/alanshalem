import { escapeHtml } from './escape.ts';
import { isWordChar, smartenText } from './typography.ts';
import { isExternalUrl, sanitizeUrl } from './url.ts';

/**
 * Renderer de elementos en línea: **negrita**, *cursiva*, ~~tachado~~, `código`,
 * [links](url), ![imágenes](url), <autolinks> y referencias a notas al pie [^id].
 *
 * Es un parser simple (no implementa el algoritmo completo de delimitadores de CommonMark):
 * un énfasis cierra con una tira de delimitadores del MISMO largo que la que lo abrió.
 * Es predecible y cubre lo que se usa al escribir un blog.
 */

interface Parsed {
  html: string;
  end: number;
}

/** Lo que el renderer en línea necesita saber del documento y de las opciones. */
export interface InlineContext {
  smartTypography: boolean;
  /** HTML de la referencia `[^id]`, o null si no tiene definición (entonces queda como texto literal). */
  footnoteRef: (id: string) => string | null;
}

// Caracteres que pueden disparar sintaxis. Todo lo demás se copia escapado de una vez.
const SPECIAL = /[\\`!\[<*_~\n]/g;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]/y;

export function renderInline(source: string, ctx: InlineContext, insideLink = false): string {
  let html = '';
  let i = 0;

  while (i < source.length) {
    SPECIAL.lastIndex = i;
    const match = SPECIAL.exec(source);
    const next = match ? match.index : source.length;

    if (next > i) {
      const text = source.slice(i, next);
      html += escapeHtml(ctx.smartTypography ? smartenText(text, source[i - 1]) : text);
      i = next;
      continue;
    }

    if (source[i] === '\n') {
      // Dos espacios al final de la línea = salto duro. Si no, es un salto blando.
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

/** Texto sin marcas de Markdown (para ids de encabezados, alt de imágenes y extractos). */
export function plainInline(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, '$1')
    .replace(/\[\^[^\]\s]+\]/g, '') // el número de una nota al pie no es parte del título
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
    default:
      return null;
  }
}

/** `código` con tiras de backticks de cualquier largo. Si no cierra, la tira se muestra literal. */
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
      // Un espacio a cada lado se descarta (permite escribir `` `x` ``).
      if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      return { html: `<code>${escapeHtml(content)}</code>`, end: closeStart + closeLength };
    }
    search = closeStart + closeLength;
  }

  return { html: '`'.repeat(runLength), end: i + runLength };
}

/** `[^id]` con definición. Sin definición devuelve null y el texto sigue su camino (queda literal). */
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

/** Partes de `[label](destino "título")`. `start` apunta al '['. */
function parseLinkTarget(source: string, start: number): LinkTarget | null {
  // 1) Buscar el ']' que cierra, respetando corchetes anidados, escapes y código.
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

  // 2) Destino y título opcional.
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

/** `[texto](url "título")` o, con isImage, `![alt](url "título")`. `start` apunta al '['. */
function parseLinkOrImage(source: string, start: number, isImage: boolean, ctx: InlineContext): Parsed | null {
  const target = parseLinkTarget(source, start);
  if (!target) return null;
  const { label, title, end } = target;

  // Una URL insegura nunca produce un href/src: queda solo el texto.
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
 * Figura: el párrafo es SOLO una imagen con título y URL segura. El título pasa a ser el
 * epígrafe (con formato en línea, escapado como todo texto) y no se repite como atributo.
 * Devuelve null si no aplica, y el párrafo se renderiza como siempre.
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

/** Reglas de apertura/cierre: `_` no abre ni cierra dentro de una palabra (snake_case_name queda intacto). */
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

  // Soportado: * y _ en tiras de 1 a 3; ~ solo de 2 (~~tachado~~).
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

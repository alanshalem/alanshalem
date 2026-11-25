import { escapeHtml } from './escape.ts';
import { isExternalUrl, sanitizeUrl } from './url.ts';

/**
 * Renderer de elementos en línea: **negrita**, *cursiva*, ~~tachado~~, `código`,
 * [links](url), ![imágenes](url) y <autolinks>.
 *
 * Es un parser simple (no implementa el algoritmo completo de delimitadores de CommonMark):
 * un énfasis cierra con una tira de delimitadores del MISMO largo que la que lo abrió.
 * Es predecible y cubre lo que se usa al escribir un blog.
 */

interface Parsed {
  html: string;
  end: number;
}

// Caracteres que pueden disparar sintaxis. Todo lo demás se copia escapado de una vez.
const SPECIAL = /[\\`!\[<*_~\n]/g;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function renderInline(source: string, insideLink = false): string {
  let html = '';
  let i = 0;

  while (i < source.length) {
    SPECIAL.lastIndex = i;
    const match = SPECIAL.exec(source);
    const next = match ? match.index : source.length;

    if (next > i) {
      html += escapeHtml(source.slice(i, next));
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

    const parsed = parseSpecial(source, i, insideLink);
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
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSpecial(source: string, i: number, insideLink: boolean): Parsed | null {
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
      return source[i + 1] === '[' ? parseLinkOrImage(source, i + 1, true, insideLink) : null;
    case '[':
      return insideLink ? null : parseLinkOrImage(source, i, false, insideLink);
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
      return parseEmphasis(source, i, insideLink);
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

/** `[texto](url "título")` o, con isImage, `![alt](url "título")`. `start` apunta al '['. */
function parseLinkOrImage(source: string, start: number, isImage: boolean, insideLink: boolean): Parsed | null {
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
  const end = k + 1;

  // 3) HTML. Una URL insegura nunca produce un href/src: queda solo el texto.
  const url = sanitizeUrl(destination);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

  if (isImage) {
    const alt = escapeHtml(plainInline(label));
    if (!url) return { html: alt, end };
    return {
      html: `<img src="${escapeHtml(url)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async">`,
      end,
    };
  }

  const inner = renderInline(label, true);
  if (!url) return { html: inner, end };
  return { html: renderAnchor(url, inner, titleAttr), end };
}

function renderAnchor(url: string, innerHtml: string, titleAttr = ''): string {
  const rel = isExternalUrl(url) ? ' rel="noopener noreferrer"' : '';
  return `<a href="${escapeHtml(url)}"${titleAttr}${rel}>${innerHtml}</a>`;
}

const isSpaceOrEdge = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined): boolean => char !== undefined && WORD_CHAR.test(char);

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

function parseEmphasis(source: string, i: number, insideLink: boolean): Parsed | null {
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
        const inner = renderInline(source.slice(i + length, j), insideLink);
        return { html: wrapEmphasis(delimiter, length, inner), end: j + length };
      }
      j += runLength;
      continue;
    }
    j += 1;
  }
  return null;
}

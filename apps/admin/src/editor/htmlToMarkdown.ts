import { sanitizeUrl } from '@blog/markdown';

/*
 * HTML pegado (Google Docs, Word, una web) → Markdown limpio (S2). Sin dependencias ni DOM (corre en los tests):
 * un tokenizador tolerante arma un árbol mínimo y se recorre en dos niveles, bloques y en línea. Todo lo desconocido
 * es un envoltorio transparente; estilos, scripts y atributos se descartan. Las URLs pasan por el mismo filtro que
 * el renderer, así que un link `javascript:` se pierde y queda su texto.
 */

interface Element {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: Node[];
}
type Node = Element | string;

export interface Converted {
  readonly markdown: string;
  /** Si hubo formato real (títulos, negrita, links…). Si no, conviene pegar el texto plano tal cual. */
  readonly formatted: boolean;
}

// Se tiran con todo su contenido.
const DROPPED = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'select']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'source', 'area', 'base', 'embed', 'param', 'track']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address',
  'body', 'html', 'center', 'dl', 'dt', 'dd', 'details', 'summary', 'form', 'fieldset', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'table',
]);
// Abrir uno de estos cierra el hermano abierto del mismo tipo (HTML permite omitir </p>, </li>, </td>…).
const SELF_CLOSING_SIBLINGS: Readonly<Record<string, readonly string[]>> = {
  p: ['p'], li: ['li'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'],
};
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™',
};
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const HARD_BREAK = '\\\n';

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, name = '', double, single, bare] of source.matchAll(ATTRIBUTE)) {
    attrs[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attrs;
}

function parseHtml(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  const current = (): Element => stack[stack.length - 1] ?? root;
  let last = 0;

  for (let match = TOKEN.exec(html); match; match = TOKEN.exec(html)) {
    if (match.index > last) current().children.push(decodeEntities(html.slice(last, match.index)));
    last = TOKEN.lastIndex;
    const [token, rawTag] = match;
    if (!rawTag) continue; // comentario o <!doctype>
    const tag = rawTag.toLowerCase();

    if (token[1] === '/') {
      const open = stack.findLastIndex((element) => element.tag === tag);
      if (open > 0) stack.length = open;
      continue;
    }
    if (DROPPED.has(tag)) {
      // Su contenido puede tener "<" sueltos (scripts): se salta hasta el cierre sin tokenizar.
      const close = html.toLowerCase().indexOf(`</${tag}`, last);
      last = close === -1 ? html.length : html.indexOf('>', close) + 1 || html.length;
      TOKEN.lastIndex = last;
      continue;
    }
    const siblings = SELF_CLOSING_SIBLINGS[tag];
    if (siblings?.includes(current().tag)) stack.pop();
    const element: Element = { tag, attrs: parseAttributes(match[2] ?? ''), children: [] };
    current().children.push(element);
    if (!VOID.has(tag) && !token.endsWith('/>')) stack.push(element);
  }
  if (last < html.length) current().children.push(decodeEntities(html.slice(last)));
  TOKEN.lastIndex = 0;
  return root;
}

/* ------------------------------ Conversión ------------------------------ */

interface Format {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}
const NO_FORMAT: Format = { bold: false, italic: false, strike: false };
const MARKERS: ReadonlyArray<[keyof Format, string]> = [['strike', '~~'], ['bold', '**'], ['italic', '*']];

const styleOf = (element: Element): string => (element.attrs.style ?? '').toLowerCase().replace(/\s+/g, '');

/** El formato que agrega este elemento: por etiqueta o por estilo en línea (Google Docs usa <span style>). */
function formatOf(element: Element): Format {
  const style = styleOf(element);
  const weight = /font-weight:(\w+)/.exec(style)?.[1];
  const fontStyle = /font-style:(\w+)/.exec(style)?.[1];
  const normalWeight = weight === 'normal' || (weight !== undefined && Number(weight) < 600);
  return {
    // El <b style="font-weight:normal"> que envuelve todo lo pegado de Google Docs NO es negrita.
    bold: ((element.tag === 'b' || element.tag === 'strong') && !normalWeight) || weight === 'bold' || Number(weight) >= 600,
    italic: ((element.tag === 'i' || element.tag === 'em') && fontStyle !== 'normal') || fontStyle === 'italic',
    strike: ['s', 'del', 'strike'].includes(element.tag) || /text-decoration[\w-]*:[^;]*line-through/.test(style),
  };
}

const textContent = (node: Node): string =>
  typeof node === 'string' ? node : node.tag === 'br' ? '\n' : node.children.map(textContent).join('');

const containsBlock = (element: Element): boolean =>
  element.children.some((child) => typeof child !== 'string' && (BLOCK.has(child.tag) || containsBlock(child)));

// `_` dentro de una palabra (snake_case) no es énfasis: no se escapa, para que el Markdown quede legible.
const INLINE_SPECIAL = /[\\`*[\]]|~~|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;
const LINE_START_SPECIAL = /^(#|>|[-+](?=\s))/;
const LINE_START_NUMBER = /^(\d+)([.)])(?=\s)/;
// Un bloque que es una lista (el texto que empieza igual ya salió escapado): se pega al ítem sin línea en blanco.
const LIST_BLOCK = /^(?:-|\d+\.) /;

/**
 * El nivel de un `<hN>` pegado, en Markdown del sitio (L5): el h1 es el título del post, así que el "Título 1" de un
 * Doc entra como sección (`##`), igual que el h2; h3 es subsección y de h4 en adelante, todo `####` (más hondo no
 * se distingue en el artículo).
 */
const headingMarker = (level: number): string => '#'.repeat(Math.min(4, Math.max(2, level)));

const escapeText = (text: string): string =>
  text.replace(INLINE_SPECIAL, (special) => special.replace(/./g, (char) => `\\${char}`));

/** Envuelve en un marcador dejando afuera los espacios de los bordes (Markdown no admite "** x **"). */
function wrap(content: string, marker: string): string {
  const core = content.trim();
  if (core === '') return content;
  const lead = content.slice(0, content.indexOf(core));
  return `${lead}${marker}${core}${marker}${content.slice(lead.length + core.length)}`;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const destination = (url: string): string => (/[\s()]/.test(url) ? `<${url}>` : url);

class Converter {
  formatted = false;

  blocks(nodes: readonly Node[]): string[] {
    const out: string[] = [];
    let inline: Node[] = [];
    const flush = (): void => {
      const paragraph = this.paragraph(inline);
      if (paragraph) out.push(paragraph);
      inline = [];
    };
    for (const node of nodes) {
      if (typeof node === 'string' || (!BLOCK.has(node.tag) && !containsBlock(node))) {
        inline.push(node);
        continue;
      }
      flush();
      out.push(...this.block(node));
    }
    flush();
    return out;
  }

  private paragraph(nodes: readonly Node[], breaks = HARD_BREAK): string {
    return this.inline(nodes, NO_FORMAT, breaks)
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/^(?:\\\n)+|(?:\\\n|\\$)+$/g, '') // un <br> al principio o al final del párrafo no significa nada
      .split('\n')
      .map((line) => line.replace(LINE_START_SPECIAL, '\\$1').replace(LINE_START_NUMBER, '$1\\$2'))
      .join('\n')
      .trim();
  }

  private block(element: Element): string[] {
    const { tag } = element;
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      this.formatted = true;
      const text = this.paragraph(element.children, ' ');
      return text ? [`${headingMarker(Number(heading[1]))} ${text}`] : [];
    }
    switch (tag) {
      case 'hr':
        this.formatted = true;
        return ['---'];
      case 'ul':
      case 'ol':
        this.formatted = true;
        return [this.list(element)];
      case 'blockquote': {
        this.formatted = true;
        const body = this.blocks(element.children).join('\n\n');
        return body ? [body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')] : [];
      }
      case 'pre':
        this.formatted = true;
        return [this.codeBlock(element)];
      case 'table':
        this.formatted = true;
        return this.table(element);
      default:
        // div, section, li fuera de lista, inline con bloques adentro (el <b> de Google Docs)…: transparentes.
        return this.blocks(element.children);
    }
  }

  private list(element: Element): string {
    const ordered = element.tag === 'ol';
    let number = ordered ? Number.parseInt(element.attrs.start ?? '1', 10) || 1 : 1;
    const items: string[] = [];
    for (const child of element.children) {
      if (typeof child === 'string') continue;
      // Google Docs anida con <ul> directamente dentro de <ul>: va bajo el ítem anterior.
      if ((child.tag === 'ul' || child.tag === 'ol') && items.length > 0) {
        const marker = ordered ? `${number - 1}. ` : '- ';
        items[items.length - 1] += `\n${indent(this.list(child), marker.length)}`;
        continue;
      }
      const marker = ordered ? `${number}. ` : '- ';
      number += 1;
      const body = this.blocks(child.tag === 'li' ? child.children : [child]).reduce(
        (joined, block) => (joined === '' ? block : `${joined}${LIST_BLOCK.test(block) ? '\n' : '\n\n'}${block}`),
        '',
      );
      items.push(marker + indent(body, marker.length).trimStart());
    }
    return items.join('\n');
  }

  private codeBlock(element: Element): string {
    const code = element.children.find((child): child is Element => typeof child !== 'string' && child.tag === 'code');
    const className = `${element.attrs.class ?? ''} ${code?.attrs.class ?? ''}`;
    const language = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(className)?.[1] ?? '';
    const text = textContent(element).replace(/^\n/, '').replace(/\n$/, '');
    const longest = Math.max(2, ...Array.from(text.matchAll(/^`{3,}/gm), (run) => run[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${language}\n${text}\n${fence}`;
  }

  private table(element: Element): string[] {
    const rows: Element[] = [];
    const collect = (node: Element): void => {
      for (const child of node.children) {
        if (typeof child === 'string') continue;
        if (child.tag === 'tr') rows.push(child);
        else if (['thead', 'tbody', 'tfoot'].includes(child.tag)) collect(child);
      }
    };
    collect(element);
    const cells = rows.map((row) =>
      row.children
        .filter((cell): cell is Element => typeof cell !== 'string' && (cell.tag === 'td' || cell.tag === 'th'))
        .map((cell) => this.paragraph(cell.children, ' ').replace(/\|/g, '\\|')),
    );
    const columns = Math.max(0, ...cells.map((row) => row.length));
    if (columns === 0) return [];
    const line = (row: readonly string[]): string =>
      `| ${Array.from({ length: columns }, (_, column) => row[column] ?? '').join(' | ')} |`;
    const [header = [], ...body] = cells;
    return [[line(header), line(Array<string>(columns).fill('---')), ...body.map(line)].join('\n')];
  }

  private inline(nodes: readonly Node[], format: Format, breaks: string): string {
    return nodes.map((node) => this.inlineNode(node, format, breaks)).join('');
  }

  private inlineNode(node: Node, format: Format, breaks: string): string {
    if (typeof node === 'string') return escapeText(node.replace(/\s+/g, ' '));
    switch (node.tag) {
      case 'br':
        return breaks;
      case 'img': {
        const src = sanitizeUrl(node.attrs.src ?? '');
        if (!src) return '';
        this.formatted = true;
        return `![${escapeText((node.attrs.alt ?? '').replace(/\s+/g, ' ').trim())}](${destination(src)})`;
      }
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt': {
        const text = textContent(node).replace(/\s+/g, ' ');
        if (text.trim() === '') return text;
        this.formatted = true;
        return codeSpan(text);
      }
      case 'a': {
        const text = this.inline(node.children, format, breaks);
        const href = sanitizeUrl(node.attrs.href ?? '');
        if (!href || text.trim() === '') return text;
        this.formatted = true;
        return wrap(text, '').replace(text.trim(), `[${text.trim()}](${destination(href)})`);
      }
      default: {
        const own = formatOf(node);
        const combined: Format = {
          bold: format.bold || own.bold,
          italic: format.italic || own.italic,
          strike: format.strike || own.strike,
        };
        let text = this.inline(node.children, combined, breaks);
        for (const [kind, marker] of MARKERS) {
          if (!own[kind] || format[kind] || text.trim() === '') continue;
          this.formatted = true;
          text = wrap(text, marker);
        }
        return text;
      }
    }
  }
}

const indent = (text: string, width: number): string =>
  text.split('\n').map((line) => (line ? ' '.repeat(width) + line : line)).join('\n');

export function htmlToMarkdown(html: string): Converted {
  const converter = new Converter();
  const markdown = converter.blocks(parseHtml(html).children).join('\n\n').trim();
  return { markdown, formatted: converter.formatted };
}

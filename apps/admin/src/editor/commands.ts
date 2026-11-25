import { clamp, runAfter, runBefore, selectedLinesRange } from './text.ts';
import type { Command, TextEdit } from './types.ts';

/* =========================================================================
   Comandos del editor. Todos son funciones puras: (estado) => edición | null.
   ========================================================================= */

/* ------------------------- Formato en línea ------------------------- */

/**
 * Negrita / cursiva / código / tachado. Si la selección ya está envuelta en el marcador
 * (adentro o justo afuera) lo saca; si no, lo agrega. Con cursor sin selección inserta
 * el par de marcadores y deja el cursor en el medio.
 */
export function toggleInline(marker: string): Command {
  const char = marker[0] ?? '';
  const length = marker.length;
  // `*` y `_` simples: una tira par (`**`) es negrita, no cursiva. Para el resto alcanza con que la tira sea >= al marcador.
  const isWrappedBy = (run: number): boolean =>
    length === 1 && (char === '*' || char === '_') ? run % 2 === 1 : run >= length;

  return ({ value, start, end }) => {
    const selected = value.slice(start, end);

    // 1) Los marcadores están dentro de la selección: "**hola**" seleccionado.
    const leading = runAfter(selected, 0, char);
    const trailing = runBefore(selected, selected.length, char);
    if (
      selected.length >= 2 * length &&
      leading + trailing < selected.length &&
      isWrappedBy(Math.min(leading, trailing))
    ) {
      const inner = selected.slice(length, selected.length - length);
      return { from: start, to: end, insert: inner, selectStart: start, selectEnd: start + inner.length };
    }

    // 2) Los marcadores están justo afuera: "**" + [hola] + "**".
    const before = runBefore(value, start, char);
    const after = runAfter(value, end, char);
    if (Math.min(before, after) > 0 && isWrappedBy(Math.min(before, after))) {
      return {
        from: start - length,
        to: end + length,
        insert: selected,
        selectStart: start - length,
        selectEnd: start - length + selected.length,
      };
    }

    // 3) Envolver. Los espacios de los bordes quedan afuera: Markdown no admite "** hola **".
    const core = selected.trim();
    if (core === '') {
      return {
        from: start,
        to: end,
        insert: marker + selected + marker,
        selectStart: start + length,
        selectEnd: start + length + selected.length,
      };
    }
    const lead = selected.slice(0, selected.indexOf(core));
    const trail = selected.slice(lead.length + core.length);
    const selectStart = start + lead.length + length;
    return {
      from: start,
      to: end,
      insert: `${lead}${marker}${core}${marker}${trail}`,
      selectStart,
      selectEnd: selectStart + core.length,
    };
  };
}

export const toggleBold = toggleInline('**');
export const toggleItalic = toggleInline('*');
export const toggleCode = toggleInline('`');
export const toggleStrike = toggleInline('~~');

const URL_PATTERN = /^https?:\/\/\S+$/i;
export const looksLikeUrl = (text: string): boolean => URL_PATTERN.test(text.trim());

/** Ctrl+K: [texto](url) y deja seleccionada la parte que falta completar. */
export const insertLink: Command = ({ value, start, end }) => {
  const selected = value.slice(start, end);

  if (looksLikeUrl(selected)) {
    // Había una URL seleccionada: falta el texto del link.
    const placeholder = 'texto';
    return {
      from: start,
      to: end,
      insert: `[${placeholder}](${selected.trim()})`,
      selectStart: start + 1,
      selectEnd: start + 1 + placeholder.length,
    };
  }

  const text = selected || 'texto';
  const placeholder = 'url';
  const urlStart = start + text.length + 3; // "[" + text + "]("
  return {
    from: start,
    to: end,
    insert: `[${text}](${placeholder})`,
    // Con texto ya escrito se selecciona la url; sin texto, el texto de relleno.
    selectStart: selected ? urlStart : start + 1,
    selectEnd: selected ? urlStart + placeholder.length : start + 1 + text.length,
  };
};

/** Pegar una URL sobre texto seleccionado lo convierte en link. Si no aplica, `null` (pegado normal). */
export function pasteUrlAsLink(clipboardText: string): Command {
  return ({ value, start, end }) => {
    if (start === end || !looksLikeUrl(clipboardText)) return null;
    const selected = value.slice(start, end);
    if (selected.includes('\n')) return null;
    const insert = `[${selected}](${clipboardText.trim()})`;
    return { from: start, to: end, insert, selectStart: start + insert.length, selectEnd: start + insert.length };
  };
}

/** Imagen en Markdown a partir de una URL (la subida del archivo la hace el componente). */
export function insertImage(url: string, alt = ''): Command {
  return ({ value, start, end }) => {
    const text = (alt || value.slice(start, end)).replace(/[[\]\n]/g, ' ').trim();
    // Con espacios o paréntesis la URL va entre <...> para que no corte el destino.
    const destination = /[\s()]/.test(url) ? `<${url}>` : url;
    const insert = `![${text}](${destination})`;
    return { from: start, to: end, insert, selectStart: start + insert.length, selectEnd: start + insert.length };
  };
}

/* --------------------------- Encabezados --------------------------- */

const HEADING_PREFIX = /^(#{1,6})[ \t]+/;

/** Pone el encabezado del nivel pedido en la línea del cursor; si ya lo tenía, lo saca (0 = párrafo normal). */
export function setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): Command {
  return ({ value, start, end }) => {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const newline = value.indexOf('\n', start);
    const lineEnd = newline === -1 ? value.length : newline;
    const line = value.slice(lineStart, lineEnd);

    const current = HEADING_PREFIX.exec(line);
    const currentLevel = current?.[1]?.length ?? 0;
    const targetLevel = currentLevel === level ? 0 : level;
    const newPrefix = targetLevel > 0 ? `${'#'.repeat(targetLevel)} ` : '';
    const newLine = newPrefix + line.replace(HEADING_PREFIX, '');

    const delta = newLine.length - line.length;
    const selectStart = clamp(start + delta, lineStart + newPrefix.length, lineStart + newLine.length);
    return {
      from: lineStart,
      to: lineEnd,
      insert: newLine,
      selectStart,
      selectEnd: Math.max(selectStart, end + delta),
    };
  };
}

/* ----------------------- Listas y citas (por línea) ----------------------- */

type LineKind = 'ul' | 'ol' | 'quote';

const LINE_KINDS: Record<LineKind, { has: RegExp; make: (n: number) => string }> = {
  ul: { has: /^(\s*)[-*+][ \t]+/, make: () => '- ' },
  ol: { has: /^(\s*)\d+[.)][ \t]+/, make: (n) => `${n}. ` },
  quote: { has: /^(\s*)>[ \t]?/, make: () => '> ' },
};
const ANY_LIST_PREFIX = /^(\s*)(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Viñetas, lista numerada o cita sobre todas las líneas seleccionadas.
 * Si todas las líneas ya la tienen, la quita (toggle).
 */
export function toggleLineKind(kind: LineKind): Command {
  const { has, make } = LINE_KINDS[kind];

  return (state) => {
    const { value, start, end } = state;
    const { lineStart, lineEnd } = selectedLinesRange(state);
    const lines = value.slice(lineStart, lineEnd).split('\n');

    const nonBlank = lines.filter((line) => line.trim() !== '');
    const allHave = nonBlank.length > 0 && nonBlank.every((line) => has.test(line));

    let counter = 0;
    const newLines = lines.map((line) => {
      // Las líneas en blanco se respetan, salvo que TODA la selección sea una línea vacía (ahí se agrega igual).
      if (nonBlank.length > 0 && line.trim() === '') return line;
      if (allHave) return line.replace(has, '$1');
      counter += 1;
      // Cambiar de tipo de lista reemplaza el prefijo viejo; una cita simplemente se suma.
      const indent = /^\s*/.exec(line)?.[0] ?? '';
      const rest = kind === 'quote' ? line.slice(indent.length) : line.replace(ANY_LIST_PREFIX, '').trimStart();
      return indent + make(counter) + rest;
    });

    const insert = newLines.join('\n');
    return { from: lineStart, to: lineEnd, insert, ...selectionAfterLineEdit(state, lineStart, lines, newLines) };
  };
}

export const toggleBulletList = toggleLineKind('ul');
export const toggleNumberedList = toggleLineKind('ol');
export const toggleQuote = toggleLineKind('quote');

/**
 * Cursor simple: se mantiene en la misma columna relativa de su línea.
 * Selección de varias líneas: queda seleccionado todo el bloque editado.
 */
function selectionAfterLineEdit(
  state: { value: string; start: number; end: number },
  lineStart: number,
  oldLines: string[],
  newLines: string[],
): Pick<TextEdit, 'selectStart' | 'selectEnd'> {
  if (state.start === state.end) {
    const oldLine = oldLines[0] ?? '';
    const newLine = newLines[0] ?? '';
    const column = clamp(state.start - lineStart + (newLine.length - oldLine.length), 0, newLine.length);
    return { selectStart: lineStart + column, selectEnd: lineStart + column };
  }
  return { selectStart: lineStart, selectEnd: lineStart + newLines.join('\n').length };
}

/* ---------------------------- Sangría (Tab) ---------------------------- */

/**
 * Tab / Shift+Tab: anida o des-anida ítems de lista. Solo actúa sobre listas o sobre una selección
 * de varias líneas; en cualquier otro caso devuelve `null` para no robarle el Tab al navegador
 * (si no, el teclado quedaría "atrapado" en el textarea).
 */
export function changeIndent(direction: 1 | -1): Command {
  return (state) => {
    const { value, start, end } = state;
    const { lineStart, lineEnd } = selectedLinesRange(state);
    const lines = value.slice(lineStart, lineEnd).split('\n');

    const multiLine = lines.length > 1;
    if (!multiLine && !ANY_LIST_PREFIX.test(lines[0] ?? '')) return null;

    const newLines = lines.map((line) => {
      if (line.trim() === '') return line;
      const unit = indentUnit(line);
      if (direction === 1) return ' '.repeat(unit) + line;
      const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
      if (leading.startsWith('\t')) return line.slice(1);
      return line.slice(Math.min(unit, leading.length));
    });

    const insert = newLines.join('\n');
    if (insert === value.slice(lineStart, lineEnd)) return null;

    const selection = selectionAfterLineEdit({ value, start, end }, lineStart, lines, newLines);
    return { from: lineStart, to: lineEnd, insert, ...selection };
  };
}

/** Un ítem numerado se anida bajo el ancho de su marcador ("1. " = 3); el resto, 2 espacios. */
function indentUnit(line: string): number {
  const ordered = /^(\s*)(\d+[.)][ \t]+)/.exec(line);
  return ordered ? (ordered[2] ?? '').length : 2;
}

/* ----------------------- Enter: continuar la lista ----------------------- */

const LIST_LINE = /^(\s*)(?:([-*+])|(\d+)([.)]))([ \t]+)(.*)$/;
const QUOTE_LINE = /^(\s*>[ \t]?)(.*)$/;

/**
 * Enter dentro de un ítem de lista o cita: abre el siguiente ítem (con el número incrementado).
 * Enter sobre un ítem vacío termina la lista. Fuera de listas devuelve `null` (Enter normal).
 */
export const continueMarkdownBlock: Command = ({ value, start, end }) => {
  if (start !== end) return null;

  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const newline = value.indexOf('\n', start);
  const lineEnd = newline === -1 ? value.length : newline;
  const line = value.slice(lineStart, lineEnd);
  const column = start - lineStart;

  const exitBlock = (): TextEdit => ({ from: lineStart, to: lineEnd, insert: '', selectStart: lineStart, selectEnd: lineStart });
  const nextLine = (prefix: string): TextEdit => {
    const insert = `\n${prefix}`;
    const cursor = start + insert.length;
    return { from: start, to: start, insert, selectStart: cursor, selectEnd: cursor };
  };

  const list = LIST_LINE.exec(line);
  if (list) {
    const [, indent = '', bullet, number, delimiter = '', space = ' ', content = ''] = list;
    const prefixLength = line.length - content.length;
    if (column < prefixLength) return null; // cursor dentro del marcador: Enter normal
    if (content.trim() === '') return exitBlock();
    const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
    return nextLine(`${indent}${marker}${space}`);
  }

  const quote = QUOTE_LINE.exec(line);
  if (quote) {
    const [, prefix = '> ', content = ''] = quote;
    if (column < prefix.length) return null;
    if (content.trim() === '') return exitBlock();
    return nextLine(prefix);
  }

  return null;
};

/* ----------------------- Bloques (código, tabla, regla) ----------------------- */

/**
 * Inserta `text` como bloque propio, separado por líneas en blanco del texto vecino
 * (Markdown necesita eso para reconocer bloques). `focus` marca qué parte de `text` queda seleccionada.
 */
function insertAsBlock(
  { value, start, end }: { value: string; start: number; end: number },
  text: string,
  focus: { from: number; to: number },
): TextEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const newlinesBefore = /\n*$/.exec(before)?.[0].length ?? 0;
  const newlinesAfter = /^\n*/.exec(after)?.[0].length ?? 0;

  const prefix = start === 0 ? '' : '\n'.repeat(Math.max(0, 2 - newlinesBefore));
  const suffix = after === '' ? '' : '\n'.repeat(Math.max(0, 2 - newlinesAfter));

  const base = start + prefix.length;
  return {
    from: start,
    to: end,
    insert: prefix + text + suffix,
    selectStart: base + focus.from,
    selectEnd: base + focus.to,
  };
}

/** Bloque de código con la selección adentro (o vacío, con el cursor listo para escribir). */
export const insertCodeBlock: Command = (state) => {
  const selected = state.value.slice(state.start, state.end);
  return insertAsBlock(state, `\`\`\`\n${selected}\n\`\`\``, { from: 4, to: 4 + selected.length });
};

const TABLE_TEMPLATE = '| Columna | Columna |\n| --- | --- |\n| Dato | Dato |';
export const insertTable: Command = (state) =>
  insertAsBlock(state, TABLE_TEMPLATE, { from: 2, to: 9 });

export const insertHorizontalRule: Command = (state) =>
  insertAsBlock(state, '---', { from: 3, to: 3 });

import { LANGS, type Lang } from '../languages.ts';
import { calloutMarker, FOOTNOTE_DEFINITION, FOOTNOTE_REFERENCE, type CalloutKind } from './markdownSource.ts';
import { clamp, runAfter, runBefore, selectedLinesRange } from './text.ts';
import type { Command, TextEdit } from './types.ts';

/**
 * Textos de relleno que quedan DENTRO del post: van en el idioma del post, no en el de la interfaz (el corrector y
 * quien lee el post usan ese idioma). Los comandos que los usan existen uno por idioma (`insertLink.en`).
 */
const CONTENT_PLACEHOLDERS: Record<Lang, { text: string; column: string; cell: string; uploading: string; alt: string; caption: string }> = {
  es: { text: 'texto', column: 'Columna', cell: 'Dato', uploading: 'Subiendo…', alt: 'descripción', caption: 'epígrafe' },
  en: { text: 'text', column: 'Column', cell: 'Value', uploading: 'Uploading…', alt: 'description', caption: 'caption' },
};
/** El destino de relleno de Ctrl+K: el revisor lo trata como un link vacío. */
export const URL_PLACEHOLDER = 'url';

const perLang = (make: (lang: Lang) => Command): Record<Lang, Command> =>
  Object.fromEntries(LANGS.map((lang) => [lang, make(lang)])) as Record<Lang, Command>;

/** Lo que se ve en el texto mientras sube una imagen pegada o soltada; después se reemplaza o se quita. */
export const uploadPlaceholder = (lang: Lang): string => `![${CONTENT_PLACEHOLDERS[lang].uploading}]()`;

/** Reemplaza la selección por `text` y deja el cursor al final (HTML pegado ya convertido, marcadores). */
export function insertText(text: string): Command {
  return ({ start, end }) => ({ from: start, to: end, insert: text, selectStart: start + text.length, selectEnd: start + text.length });
}

/* =========================================================================
   Comandos del editor. Todos son funciones puras: (estado) => edición | null.
   ========================================================================= */

/* ------------------------- Formato en línea ------------------------- */

/**
 * Negrita / cursiva / código / tachado. Si la selección ya está envuelta en el marcador
 * (adentro o justo afuera) lo saca; si no, lo agrega. Con cursor sin selección inserta
 * el par de marcadores y deja el cursor en el medio.
 */
function toggleInline(marker: string): Command {
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
const looksLikeUrl = (text: string): boolean => URL_PATTERN.test(text.trim());

const LINK = /\[[^\]\n]*\]\(([^)\n]*)\)/g;

/** Si la selección está dentro de un `[texto](url)`, selecciona su url: Ctrl+K edita el link en vez de anidar otro. */
function selectLinkUrlAt(value: string, start: number, end: number): TextEdit | null {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const newline = value.indexOf('\n', start);
  const line = value.slice(lineStart, newline === -1 ? value.length : newline);
  for (const match of line.matchAll(LINK)) {
    const from = lineStart + match.index;
    const to = from + match[0].length;
    if (start <= from || end >= to) continue;
    const urlEnd = to - 1;
    return { from: start, to: start, insert: '', selectStart: urlEnd - (match[1] ?? '').length, selectEnd: urlEnd };
  }
  return null;
}

/** Ctrl+K: [texto](url) y deja seleccionada la parte que falta completar. */
export const insertLink = perLang((lang): Command => ({ value, start, end }) => {
  const existing = selectLinkUrlAt(value, start, end);
  if (existing) return existing;

  const selected = value.slice(start, end);
  const placeholder = CONTENT_PLACEHOLDERS[lang].text;

  if (looksLikeUrl(selected)) {
    // Había una URL seleccionada: falta el texto del link.
    return {
      from: start,
      to: end,
      insert: `[${placeholder}](${selected.trim()})`,
      selectStart: start + 1,
      selectEnd: start + 1 + placeholder.length,
    };
  }

  const text = selected || placeholder;
  const urlStart = start + text.length + 3; // "[" + text + "]("
  return {
    from: start,
    to: end,
    insert: `[${text}](${URL_PLACEHOLDER})`,
    // Con texto ya escrito se selecciona la url; sin texto, el texto de relleno.
    selectStart: selected ? urlStart : start + 1,
    selectEnd: selected ? urlStart + URL_PLACEHOLDER.length : start + 1 + text.length,
  };
});

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

/**
 * `![alt](url)` de una imagen ya subida (la subida la hace useImageUpload). Con espacios o paréntesis la URL va
 * entre <...> para que no corte el destino; corchetes y saltos del alt se vuelven espacios.
 */
export function imageMarkdown(url: string, alt: string): string {
  const text = alt.replace(/[[\]\n]/g, ' ').trim();
  return `![${text}](${/[\s()]/.test(url) ? `<${url}>` : url})`;
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
function toggleLineKind(kind: LineKind): Command {
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

/** Tabla de 2×2 con el primer encabezado seleccionado para escribirlo. */
export const insertTable = perLang((lang): Command => {
  const { column, cell } = CONTENT_PLACEHOLDERS[lang];
  const template = `| ${column} | ${column} |\n| --- | --- |\n| ${cell} | ${cell} |`;
  return (state) => insertAsBlock(state, template, { from: 2, to: 2 + column.length });
});

export const insertHorizontalRule: Command = (state) =>
  insertAsBlock(state, '---', { from: 3, to: 3 });

/**
 * `markdown` en un párrafo propio (una imagen pegada o soltada): sin pegarse a la palabra de al lado y, sola en su
 * párrafo, con un título puede ser una figura. Los espacios del borde se van con el corte; el cursor queda después
 * del bloque, para seguir escribiendo en el párrafo siguiente.
 */
export function insertBlock(markdown: string): Command {
  return ({ value, start, end }) => {
    const from = start - (/[ \t]*$/.exec(value.slice(0, start))?.[0].length ?? 0);
    const to = end + (/^[ \t]*/.exec(value.slice(end))?.[0].length ?? 0);
    const edit = insertAsBlock({ value, start: from, end: to }, markdown, { from: 0, to: 0 });
    const after = edit.from + edit.insert.length;
    return { ...edit, selectStart: after, selectEnd: after };
  };
}

/**
 * El rango que hay que borrar para sacar el bloque [from, to) sin dejar líneas en blanco de más: lo inverso de
 * insertBlock (una subida que falló). Si mientras tanto se escribió pegado al bloque, solo se va el bloque.
 */
export function blockSpan(value: string, from: number, to: number): { from: number; to: number } {
  const newlinesAfter = /^\n*/.exec(value.slice(to))?.[0].length ?? 0;
  // El último del documento: también los saltos que lo separaban del anterior.
  if (to + newlinesAfter === value.length) return { from: from - (/\n*$/.exec(value.slice(0, from))?.[0].length ?? 0), to: value.length };
  const startsParagraph = from === 0 || value.slice(0, from).endsWith('\n\n');
  return { from, to: startsParagraph ? to + Math.min(2, newlinesAfter) : to };
}

/* ----------------- Markdown del sitio: figuras, cajas y notas (S4) ----------------- */

/** Figura = imagen sola en su párrafo y con título (el epígrafe). Queda seleccionada la url, lo primero que falta. */
export const insertFigure = perLang((lang): Command => {
  const { alt, caption } = CONTENT_PLACEHOLDERS[lang];
  const urlStart = alt.length + 4; // "![" + alt + "]("
  return (state) =>
    insertAsBlock(state, `![${alt}](${URL_PLACEHOLDER} "${caption}")`, { from: urlStart, to: urlStart + URL_PLACEHOLDER.length });
});

/** Caja destacada con las líneas seleccionadas (o la del cursor) adentro; sin texto, el de relleno seleccionado. */
export function insertCallout(kind: CalloutKind): Record<Lang, Command> {
  return perLang((lang) => (state) => {
    const { lineStart, lineEnd } = selectedLinesRange(state);
    const selected = state.value.slice(lineStart, lineEnd);
    const body = (selected.trim() === '' ? CONTENT_PLACEHOLDERS[lang].text : selected).split('\n').map((line) => `> ${line}`).join('\n');
    const marker = `> ${calloutMarker(kind)}\n`;
    return insertAsBlock({ ...state, start: lineStart, end: lineEnd }, marker + body, {
      from: marker.length + 2,
      to: marker.length + body.length,
    });
  });
}

/**
 * `[^n]` después de la selección y su definición al final del texto, con el texto de relleno seleccionado para
 * escribir la nota. `n` sigue al mayor número usado (los ids con nombre no cuentan). Es UNA edición (del cursor al
 * final) para que Ctrl+Z la deshaga de una vez.
 */
export const insertFootnote = perLang((lang): Command => ({ value, end }) => {
  const used = [...value.matchAll(FOOTNOTE_REFERENCE)].map((match) => Number(match[1])).filter(Number.isInteger);
  const n = Math.max(0, ...used) + 1;
  const before = `${value.slice(0, end)}[^${n}]${value.slice(end).trimEnd()}`;
  // Junto a las otras definiciones si el texto ya termina en una; si no, en un párrafo aparte.
  const lastLine = before.slice(before.lastIndexOf('\n') + 1);
  const definition = `${FOOTNOTE_DEFINITION.test(lastLine) ? '\n' : '\n\n'}[^${n}]: `;
  const insert = before.slice(end) + definition + CONTENT_PLACEHOLDERS[lang].text;
  const selectEnd = end + insert.length;
  return { from: end, to: value.length, insert, selectStart: selectEnd - CONTENT_PLACEHOLDERS[lang].text.length, selectEnd };
});

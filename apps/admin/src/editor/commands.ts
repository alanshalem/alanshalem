import { LANGS, type Lang } from '../languages.ts';
import { calloutMarker, FOOTNOTE_DEFINITION, FOOTNOTE_REFERENCE, type CalloutKind } from './markdownSource.ts';
import { clamp, runAfter, runBefore, selectedLinesRange } from './text.ts';
import type { Command, TextEdit } from './types.ts';

/**
 * Placeholder texts that end up INSIDE the post: they are in the post's language, not the UI's (the spell checker and
 * the post's readers use that language). The commands that use them exist once per language (`insertLink.en`).
 */
const CONTENT_PLACEHOLDERS: Record<Lang, { text: string; column: string; cell: string; uploading: string; alt: string; caption: string }> = {
  es: { text: 'texto', column: 'Columna', cell: 'Dato', uploading: 'Subiendo…', alt: 'descripción', caption: 'epígrafe' },
  en: { text: 'text', column: 'Column', cell: 'Value', uploading: 'Uploading…', alt: 'description', caption: 'caption' },
};
/** The placeholder target of Ctrl+K: the reviewer treats it as an empty link. */
export const URL_PLACEHOLDER = 'url';

const perLang = (make: (lang: Lang) => Command): Record<Lang, Command> =>
  Object.fromEntries(LANGS.map((lang) => [lang, make(lang)])) as Record<Lang, Command>;

/** What shows in the text while a pasted or dropped image uploads; afterwards it is replaced or removed. */
export const uploadPlaceholder = (lang: Lang): string => `![${CONTENT_PLACEHOLDERS[lang].uploading}]()`;

/** Replaces the selection with `text` and leaves the caret at the end (already converted pasted HTML, markers). */
export function insertText(text: string): Command {
  return ({ start, end }) => ({ from: start, to: end, insert: text, selectStart: start + text.length, selectEnd: start + text.length });
}

/* =========================================================================
   Editor commands. All of them are pure functions: (state) => edit | null.
   ========================================================================= */

/* ------------------------- Inline formatting ------------------------- */

/**
 * Bold / italic / code / strikethrough. If the selection is already wrapped in the marker (inside or right outside)
 * it removes it; otherwise it adds it. With a caret and no selection it inserts the marker pair and leaves the caret
 * in the middle.
 */
function toggleInline(marker: string): Command {
  const char = marker[0] ?? '';
  const length = marker.length;
  // Single `*` and `_`: an even run (`**`) is bold, not italic. For the rest a run >= the marker is enough.
  const isWrappedBy = (run: number): boolean =>
    length === 1 && (char === '*' || char === '_') ? run % 2 === 1 : run >= length;

  return ({ value, start, end }) => {
    const selected = value.slice(start, end);

    // 1) The markers are inside the selection: "**hola**" selected.
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

    // 2) The markers are right outside: "**" + [hola] + "**".
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

    // 3) Wrap. Edge spaces stay outside: Markdown does not accept "** hola **".
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

/** If the selection is inside a `[text](url)`, selects its url: Ctrl+K edits the link instead of nesting another. */
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

/** Ctrl+K: [text](url), leaving selected the part still to fill in. */
export const insertLink = perLang((lang): Command => ({ value, start, end }) => {
  const existing = selectLinkUrlAt(value, start, end);
  if (existing) return existing;

  const selected = value.slice(start, end);
  const placeholder = CONTENT_PLACEHOLDERS[lang].text;

  if (looksLikeUrl(selected)) {
    // A URL was selected: the link text is missing.
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
    // With text already written the url is selected; without text, the placeholder text.
    selectStart: selected ? urlStart : start + 1,
    selectEnd: selected ? urlStart + URL_PLACEHOLDER.length : start + 1 + text.length,
  };
});

/** Pasting a URL over selected text turns it into a link. If it does not apply, `null` (normal paste). */
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
 * `![alt](url)` of an already uploaded image (useImageUpload does the upload). With spaces or parentheses the URL goes
 * between <...> so it does not cut the destination; brackets and line breaks in the alt become spaces.
 */
export function imageMarkdown(url: string, alt: string): string {
  const text = alt.replace(/[[\]\n]/g, ' ').trim();
  return `![${text}](${/[\s()]/.test(url) ? `<${url}>` : url})`;
}

/* ----------------------------- Headings ----------------------------- */

const HEADING_PREFIX = /^(#{1,6})[ \t]+/;

/** Sets the requested heading level on the caret's line; if it already had it, removes it (0 = normal paragraph). */
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

/* ----------------------- Lists and quotes (per line) ----------------------- */

type LineKind = 'ul' | 'ol' | 'quote';

const LINE_KINDS: Record<LineKind, { has: RegExp; make: (n: number) => string }> = {
  ul: { has: /^(\s*)[-*+][ \t]+/, make: () => '- ' },
  ol: { has: /^(\s*)\d+[.)][ \t]+/, make: (n) => `${n}. ` },
  quote: { has: /^(\s*)>[ \t]?/, make: () => '> ' },
};
const ANY_LIST_PREFIX = /^(\s*)(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Bullets, numbered list or quote over all the selected lines.
 * If every line already has it, removes it (toggle).
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
      // Blank lines are kept, unless the WHOLE selection is one empty line (then it is added anyway).
      if (nonBlank.length > 0 && line.trim() === '') return line;
      if (allHave) return line.replace(has, '$1');
      counter += 1;
      // Switching list type replaces the old prefix; a quote is simply added.
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
 * Plain caret: it keeps the same relative column of its line.
 * Multi-line selection: the whole edited block stays selected.
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

/* ---------------------------- Indentation (Tab) ---------------------------- */

/**
 * Tab / Shift+Tab: nests or un-nests list items. It only acts on lists or on a multi-line selection; in any other
 * case it returns `null` so it does not steal Tab from the browser (otherwise the keyboard would be "trapped" in the
 * textarea).
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

/** A numbered item nests under its marker's width ("1. " = 3); the rest, 2 spaces. */
function indentUnit(line: string): number {
  const ordered = /^(\s*)(\d+[.)][ \t]+)/.exec(line);
  return ordered ? (ordered[2] ?? '').length : 2;
}

/* ----------------------- Enter: continue the list ----------------------- */

const LIST_LINE = /^(\s*)(?:([-*+])|(\d+)([.)]))([ \t]+)(.*)$/;
const QUOTE_LINE = /^(\s*>[ \t]?)(.*)$/;

/**
 * Enter inside a list item or quote: opens the next item (with the number incremented).
 * Enter on an empty item ends the list. Outside lists it returns `null` (normal Enter).
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
    if (column < prefixLength) return null; // caret inside the marker: normal Enter
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

/* ----------------------- Blocks (code, table, rule) ----------------------- */

/**
 * Inserts `text` as its own block, separated from the neighboring text by blank lines (Markdown needs that to
 * recognize blocks). `focus` marks which part of `text` stays selected.
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

/** Code block with the selection inside (or empty, with the caret ready to type). */
export const insertCodeBlock: Command = (state) => {
  const selected = state.value.slice(state.start, state.end);
  return insertAsBlock(state, `\`\`\`\n${selected}\n\`\`\``, { from: 4, to: 4 + selected.length });
};

/** 2×2 table with the first header selected to type it. */
export const insertTable = perLang((lang): Command => {
  const { column, cell } = CONTENT_PLACEHOLDERS[lang];
  const template = `| ${column} | ${column} |\n| --- | --- |\n| ${cell} | ${cell} |`;
  return (state) => insertAsBlock(state, template, { from: 2, to: 2 + column.length });
});

export const insertHorizontalRule: Command = (state) =>
  insertAsBlock(state, '---', { from: 3, to: 3 });

/**
 * `markdown` in its own paragraph (a pasted or dropped image): not glued to the next word and, alone in its
 * paragraph, with a title it can be a figure. Edge spaces go with the cut; the caret stays after the block, to keep
 * typing in the next paragraph.
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
 * The range to delete to remove the block [from, to) without leaving extra blank lines: the inverse of insertBlock
 * (a failed upload). If text was typed right against the block meanwhile, only the block goes.
 */
export function blockSpan(value: string, from: number, to: number): { from: number; to: number } {
  const newlinesAfter = /^\n*/.exec(value.slice(to))?.[0].length ?? 0;
  // The last one of the document: also the line breaks that separated it from the previous one.
  if (to + newlinesAfter === value.length) return { from: from - (/\n*$/.exec(value.slice(0, from))?.[0].length ?? 0), to: value.length };
  const startsParagraph = from === 0 || value.slice(0, from).endsWith('\n\n');
  return { from, to: startsParagraph ? to + Math.min(2, newlinesAfter) : to };
}

/* ----------------- Site Markdown: figures, callouts and footnotes ----------------- */

/** Figure = image alone in its paragraph with a title (the caption). The url stays selected, the first thing missing. */
export const insertFigure = perLang((lang): Command => {
  const { alt, caption } = CONTENT_PLACEHOLDERS[lang];
  const urlStart = alt.length + 4; // "![" + alt + "]("
  return (state) =>
    insertAsBlock(state, `![${alt}](${URL_PLACEHOLDER} "${caption}")`, { from: urlStart, to: urlStart + URL_PLACEHOLDER.length });
});

/** Callout with the selected lines (or the caret's line) inside; without text, the placeholder selected. */
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
 * `[^n]` after the selection and its definition at the end of the text, with the placeholder selected to type the
 * note. `n` follows the largest number used (named ids do not count). It is ONE edit (from the caret to the end) so
 * Ctrl+Z undoes it at once.
 */
export const insertFootnote = perLang((lang): Command => ({ value, end }) => {
  const used = [...value.matchAll(FOOTNOTE_REFERENCE)].map((match) => Number(match[1])).filter(Number.isInteger);
  const n = Math.max(0, ...used) + 1;
  const before = `${value.slice(0, end)}[^${n}]${value.slice(end).trimEnd()}`;
  // Next to the other definitions if the text already ends in one; otherwise, in a separate paragraph.
  const lastLine = before.slice(before.lastIndexOf('\n') + 1);
  const definition = `${FOOTNOTE_DEFINITION.test(lastLine) ? '\n' : '\n\n'}[^${n}]: `;
  const insert = before.slice(end) + definition + CONTENT_PLACEHOLDERS[lang].text;
  const selectEnd = end + insert.length;
  return { from: end, to: value.length, insert, selectStart: selectEnd - CONTENT_PLACEHOLDERS[lang].text.length, selectEnd };
});

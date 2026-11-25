import type { TextEdit } from './types.ts';

/* Buscar y reemplazar (S2): funciones puras sobre el texto; el panel solo las conecta con el textarea. */

export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

export interface Match {
  readonly from: number;
  readonly to: number;
}

// Las letras con acento y la ñ son parte de la palabra: "año" no está dentro de "añoso".
const WORD_CHAR = '[\\p{L}\\p{N}_]';
// Solo los caracteres de sintaxis: con la bandera `u`, escapar cualquier otro es un error.
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/** Todas las apariciones literales de `query` (sin expresiones regulares: KISS para quien escribe). */
export function findMatches(text: string, query: string, { caseSensitive, wholeWord }: SearchOptions): Match[] {
  if (query === '') return [];
  const literal = query.replace(REGEX_SYNTAX, '\\$&');
  const source = wholeWord ? `(?<!${WORD_CHAR})${literal}(?!${WORD_CHAR})` : literal;
  const pattern = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  return Array.from(text.matchAll(pattern), (match) => ({ from: match.index, to: match.index + match[0].length }));
}

/**
 * El índice de la coincidencia siguiente (1) o anterior (-1) a la selección, dando la vuelta; -1 si no hay.
 * Si la selección ES una coincidencia, avanza desde su final: Enter repetido recorre todas.
 */
export function stepMatch(matches: readonly Match[], selection: { start: number; end: number }, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  if (direction === -1) {
    const before = matches.findLastIndex((match) => match.from < selection.start);
    return before === -1 ? matches.length - 1 : before;
  }
  const onMatch = matches.some((match) => match.from === selection.start && match.to === selection.end);
  const position = onMatch ? selection.end : selection.start;
  const after = matches.findIndex((match) => match.from >= position);
  return after === -1 ? 0 : after;
}

/** Reemplaza una coincidencia y deja seleccionado el reemplazo. */
export const replaceMatchEdit = (match: Match, replacement: string): TextEdit => ({
  from: match.from,
  to: match.to,
  insert: replacement,
  selectStart: match.from,
  selectEnd: match.from + replacement.length,
});

/**
 * Reemplazar todo como UNA edición (de la primera a la última coincidencia): un solo Ctrl+Z lo deshace entero.
 * El reemplazo es literal (`$&` no tiene significado especial).
 */
export function replaceAllEdit(text: string, matches: readonly Match[], replacement: string): TextEdit | null {
  const first = matches[0];
  const last = matches[matches.length - 1];
  if (!first || !last) return null;
  let insert = '';
  let cursor = first.from;
  for (const match of matches) {
    insert += text.slice(cursor, match.from) + replacement;
    cursor = match.to;
  }
  const end = first.from + insert.length;
  return { from: first.from, to: last.to, insert, selectStart: end, selectEnd: end };
}

/** La aparición de `needle` más cercana a `near` (el usuario pudo escribir antes o después); -1 si no está. */
export function nearestOccurrence(text: string, needle: string, near: number): number {
  let best = -1;
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    if (best === -1 || Math.abs(index - near) < Math.abs(best - near)) best = index;
  }
  return best;
}

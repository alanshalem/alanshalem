import type { TextEdit } from './types.ts';

/* Find and replace: pure functions over the text; the panel only connects them to the textarea. */

export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

export interface Match {
  readonly from: number;
  readonly to: number;
}

// Accented letters and ñ are part of the word: "año" is not inside "añoso".
const WORD_CHAR = '[\\p{L}\\p{N}_]';
// Only syntax characters: with the `u` flag, escaping any other is an error.
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/** Every literal occurrence of `query` (no regular expressions: KISS for the writer). */
export function findMatches(text: string, query: string, { caseSensitive, wholeWord }: SearchOptions): Match[] {
  if (query === '') return [];
  const literal = query.replace(REGEX_SYNTAX, '\\$&');
  const source = wholeWord ? `(?<!${WORD_CHAR})${literal}(?!${WORD_CHAR})` : literal;
  const pattern = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  return Array.from(text.matchAll(pattern), (match) => ({ from: match.index, to: match.index + match[0].length }));
}

/**
 * The index of the match after (1) or before (-1) the selection, wrapping around; -1 if there are none.
 * If the selection IS a match, it advances from its end: repeated Enter walks through all of them.
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

/** Replaces a match and leaves the replacement selected. */
export const replaceMatchEdit = (match: Match, replacement: string): TextEdit => ({
  from: match.from,
  to: match.to,
  insert: replacement,
  selectStart: match.from,
  selectEnd: match.from + replacement.length,
});

/**
 * Replace all as ONE edit (from the first to the last match): a single Ctrl+Z undoes it entirely.
 * The replacement is literal (`$&` has no special meaning).
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

/** The occurrence of `needle` closest to `near` (the user may have typed before or after it); -1 if absent. */
export function nearestOccurrence(text: string, needle: string, near: number): number {
  let best = -1;
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    if (best === -1 || Math.abs(index - near) < Math.abs(best - near)) best = index;
  }
  return best;
}

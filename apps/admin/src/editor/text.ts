import type { EditorState, TextEdit } from './types.ts';

/** Range [lineStart, lineEnd) of the full lines the selection touches. */
export function selectedLinesRange(state: EditorState): { lineStart: number; lineEnd: number } {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  // If the selection ends right after a line break, that next line does not count.
  const lastChar = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const newline = value.indexOf('\n', lastChar);
  return { lineStart, lineEnd: newline === -1 ? value.length : newline };
}

/** How many consecutive `char` characters end at `index` (going backwards), not including it. */
export function runBefore(value: string, index: number, char: string): number {
  let count = 0;
  while (index - count - 1 >= 0 && value[index - count - 1] === char) count += 1;
  return count;
}

/** How many consecutive `char` characters start at `index`. */
export function runAfter(value: string, index: number, char: string): number {
  let count = 0;
  while (value[index + count] === char) count += 1;
  return count;
}

/** Applies an edit to a state (used by the tests and the fallback without execCommand). */
export function applyEditToState(state: EditorState, edit: TextEdit): EditorState {
  return {
    value: state.value.slice(0, edit.from) + edit.insert + state.value.slice(edit.to),
    start: edit.selectStart,
    end: edit.selectEnd,
  };
}

/**
 * Replaces [from, to) without moving what the user has selected (an upload that finishes while they keep typing):
 * what is before stays, what is after shifts and what is inside goes to the end of the replacement.
 */
export function spliceKeepingSelection(state: EditorState, from: number, to: number, insert: string): TextEdit {
  const map = (position: number): number =>
    position <= from ? position : position >= to ? position + insert.length - (to - from) : from + insert.length;
  return { from, to, insert, selectStart: map(state.start), selectEnd: map(state.end) };
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** The text offsets where each requested line starts (past the end: the text length). */
export function lineOffsets(text: string, lines: readonly number[]): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return lines.map((line) => starts[line] ?? text.length);
}

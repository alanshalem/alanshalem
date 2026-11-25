import type { EditorState, TextEdit } from './types.ts';

/** Rango [lineStart, lineEnd) de las líneas completas que toca la selección. */
export function selectedLinesRange(state: EditorState): { lineStart: number; lineEnd: number } {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  // Si la selección termina justo después de un salto de línea, esa línea siguiente no cuenta.
  const lastChar = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const newline = value.indexOf('\n', lastChar);
  return { lineStart, lineEnd: newline === -1 ? value.length : newline };
}

/** Cuántos caracteres `char` seguidos hay terminando en `index` (hacia atrás), sin incluirlo. */
export function runBefore(value: string, index: number, char: string): number {
  let count = 0;
  while (index - count - 1 >= 0 && value[index - count - 1] === char) count += 1;
  return count;
}

/** Cuántos caracteres `char` seguidos hay empezando en `index`. */
export function runAfter(value: string, index: number, char: string): number {
  let count = 0;
  while (value[index + count] === char) count += 1;
  return count;
}

/** Aplica una edición sobre un estado (lo usan los tests y el fallback sin execCommand). */
export function applyEditToState(state: EditorState, edit: TextEdit): EditorState {
  return {
    value: state.value.slice(0, edit.from) + edit.insert + state.value.slice(edit.to),
    start: edit.selectStart,
    end: edit.selectEnd,
  };
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

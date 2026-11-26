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

/**
 * Reemplaza [from, to) sin mover lo que el usuario tiene seleccionado (una subida que termina mientras sigue
 * escribiendo): lo de antes queda igual, lo de después se corre y lo de adentro va al final del reemplazo.
 */
export function spliceKeepingSelection(state: EditorState, from: number, to: number, insert: string): TextEdit {
  const map = (position: number): number =>
    position <= from ? position : position >= to ? position + insert.length - (to - from) : from + insert.length;
  return { from, to, insert, selectStart: map(state.start), selectEnd: map(state.end) };
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Los offsets del texto donde empieza cada línea pedida (más allá del final: el largo del texto). */
export function lineOffsets(text: string, lines: readonly number[]): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return lines.map((line) => starts[line] ?? text.length);
}

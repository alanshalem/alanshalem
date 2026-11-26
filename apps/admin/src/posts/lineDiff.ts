/*
 * Diff por líneas sin dependencias (historial de versiones, S5): la subsecuencia común más larga (LCS) entre dos
 * textos. Puro, para probarlo en node. Alcanza con líneas: el cuerpo es Markdown, donde cada párrafo es una línea.
 */

export type DiffKind = 'same' | 'removed' | 'added';

/** `removed`: solo en el texto de antes; `added`: solo en el de después. */
export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * Tope de la tabla LCS (filas × columnas, 4 bytes cada celda ≈ 16 MB). Se aplica después de recortar lo común del
 * principio y del final, así que solo lo alcanzan reescrituras enteras de textos muy largos: esas se muestran como
 * reemplazo completo, que es lo que son.
 */
export const MAX_DIFF_CELLS = 4_000_000;

/** Líneas iguales que quedan a la vista alrededor de cada cambio. */
const DIFF_CONTEXT_LINES = 2;

// Un texto vacío no tiene líneas (split daría una vacía, que se vería como un cambio).
const toLines = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

const run = (kind: DiffKind, lines: readonly string[]): DiffLine[] => lines.map((text) => ({ kind, text }));

/** De `before` a `after`, línea por línea; en cada cambio, lo quitado va antes que lo agregado. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);

  // Lo común de los bordes no necesita la tabla: así el costo depende del tamaño del cambio y no del texto.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

  const oldMiddle = a.slice(start, a.length - end);
  const newMiddle = b.slice(start, b.length - end);
  return [...run('same', a.slice(0, start)), ...diffMiddle(oldMiddle, newMiddle), ...run('same', a.slice(a.length - end))];
}

function diffMiddle(a: readonly string[], b: readonly string[]): DiffLine[] {
  const columns = b.length + 1;
  if (a.length === 0 || b.length === 0 || (a.length + 1) * columns > MAX_DIFF_CELLS) {
    return [...run('removed', a), ...run('added', b)];
  }

  // lcs[i][j] = largo de la LCS de a[i..] y b[j..], en una sola tabla plana.
  const lcs = new Uint32Array((a.length + 1) * columns);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * columns + j] =
        a[i] === b[j] ? lcs[(i + 1) * columns + j + 1]! + 1 : Math.max(lcs[(i + 1) * columns + j]!, lcs[i * columns + j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i++]! });
      j++;
    } else if (lcs[(i + 1) * columns + j]! >= lcs[i * columns + j + 1]!) {
      lines.push({ kind: 'removed', text: a[i++]! });
    } else {
      lines.push({ kind: 'added', text: b[j++]! });
    }
  }
  return [...lines, ...run('removed', a.slice(i)), ...run('added', b.slice(j))];
}

/** Lo que se muestra: tramos con cambios (y su contexto) o la cuenta de líneas iguales que se omiten. */
export type DiffChunk =
  | { readonly kind: 'lines'; readonly lines: readonly DiffLine[] }
  | { readonly kind: 'skipped'; readonly count: number };

/** Esconde las líneas iguales lejos de todo cambio: en un post largo, el cambio de un párrafo no se pierde. */
export function collapseUnchanged(lines: readonly DiffLine[], context: number = DIFF_CONTEXT_LINES): DiffChunk[] {
  const visible = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near++) {
      visible[near] = true;
    }
  });

  const chunks: DiffChunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const shown = visible[index];
    let next = index;
    while (next < lines.length && visible[next] === shown) next++;
    chunks.push(shown ? { kind: 'lines', lines: lines.slice(index, next) } : { kind: 'skipped', count: next - index });
    index = next;
  }
  return chunks;
}

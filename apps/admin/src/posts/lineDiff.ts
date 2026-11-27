/*
 * Dependency-free line diff (revision history): the longest common subsequence (LCS) between two texts. Pure, so it
 * can be tested in node. Lines are enough: the body is Markdown, where each paragraph is a line.
 */

export type DiffKind = 'same' | 'removed' | 'added';

/** `removed`: only in the text before; `added`: only in the text after. */
export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * Cap of the LCS table (rows × columns, 4 bytes per cell ≈ 16 MB). It applies after trimming the common start and end,
 * so only full rewrites of very long texts reach it: those show as a full replacement, which is what they are.
 */
export const MAX_DIFF_CELLS = 4_000_000;

/** Equal lines kept visible around each change. */
const DIFF_CONTEXT_LINES = 2;

// An empty text has no lines (split would give an empty one, which would show as a change).
const toLines = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

const run = (kind: DiffKind, lines: readonly string[]): DiffLine[] => lines.map((text) => ({ kind, text }));

/** From `before` to `after`, line by line; in each change, the removed lines go before the added ones. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);

  // The common edges do not need the table: so the cost depends on the size of the change, not of the text.
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

  // lcs[i][j] = length of the LCS of a[i..] and b[j..], in one flat table.
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

/** What is shown: runs with changes (and their context) or the count of equal lines that are skipped. */
export type DiffChunk =
  | { readonly kind: 'lines'; readonly lines: readonly DiffLine[] }
  | { readonly kind: 'skipped'; readonly count: number };

/** Hides equal lines far from any change: in a long post, the change of one paragraph is not lost. */
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

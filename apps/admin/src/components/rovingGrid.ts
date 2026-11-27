import { rovingIndex } from '../editor/roving.ts';
import type { KeyLike } from '../editor/shortcuts.ts';

/*
 * Two-dimensional roving tabindex (the hero thumbnails): the grid is ONE Tab stop. Left, right, Home and End behave
 * as in the editor toolbar (`rovingIndex`, the same rule); up and down jump one row. The CSS decides the columns
 * (auto-fill), so they come as a parameter.
 */

/** The index of the thumbnail that receives focus with this key, or null if the key is not a grid key. */
export function gridIndex(event: KeyLike, current: number, count: number, columns: number): number | null {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return rovingIndex(event, current, count);
  if (count === 0 || event.ctrlKey || event.metaKey || event.altKey) return null;
  const step = Math.max(1, columns);
  if (event.key === 'ArrowUp') return current - step >= 0 ? current - step : current;
  if (current + step < count) return current + step;
  // Down into an incomplete last row: to the last thumbnail. On the last row, it stays.
  const lastRow = Math.floor((count - 1) / step);
  return Math.floor(current / step) < lastRow ? count - 1 : current;
}

import type { KeyLike } from './shortcuts.ts';

/*
 * Roving tabindex of the editor toolbar (WCAG 2.1.1, ARIA APG toolbar pattern): the toolbar is ONE Tab stop and the
 * arrows move inside it; Home and End go to the ends. So reaching the text does not take 25 Tabs.
 */

/** The index of the button that receives focus with this key, or null if the key is not a toolbar key. */
export function rovingIndex(event: KeyLike, current: number, count: number): number | null {
  // With modifiers they are shortcuts (Ctrl+End, the browser's Alt+Arrow): left alone.
  if (count === 0 || event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

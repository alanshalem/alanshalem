import {
  changeIndent,
  continueMarkdownBlock,
  insertLink,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrike,
} from './commands.ts';
import type { Command } from './types.ts';

/** Subconjunto de KeyboardEvent que necesitamos (así se puede testear sin DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Atajos del editor. Cmd en Mac, Ctrl en el resto.
 *   Mod+B negrita · Mod+I cursiva · Mod+E código · Mod+K link · Mod+Shift+X tachado
 *   Enter continúa listas/citas · Tab / Shift+Tab anidan ítems
 */
export function commandForKey(event: KeyLike): Command | null {
  if (event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (mod) {
    if (event.shiftKey) return key === 'x' ? toggleStrike : null;
    switch (key) {
      case 'b':
        return toggleBold;
      case 'i':
        return toggleItalic;
      case 'e':
        return toggleCode;
      case 'k':
        return insertLink;
      default:
        return null;
    }
  }

  if (key === 'enter' && !event.shiftKey) return continueMarkdownBlock;
  if (key === 'tab') return changeIndent(event.shiftKey ? -1 : 1);
  return null;
}

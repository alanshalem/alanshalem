import { DEFAULT_LANG, type Lang } from '../languages.ts';
import { editorActions, type EditorAction } from './actions.ts';
import type { Command } from './types.ts';

/** The subset of KeyboardEvent we need (so it can be tested without a DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A key combination. `mod` = Cmd on Mac, Ctrl elsewhere. */
export interface Chord {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
}

// A symbol ("/") may need Shift depending on the layout (on the Spanish keyboard it is Shift+7): not required.
const LAYOUT_SYMBOL = /^[^\p{L}\p{N}]$/u;
const KEY_NAMES: Readonly<Record<string, string>> = { Escape: 'Esc' };

export function matchesChord(event: KeyLike, chord: Chord): boolean {
  // AltGr arrives as Ctrl+Alt on Windows: with Alt there is never a shortcut, so @, # or | can be typed.
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) !== (chord.mod ?? false)) return false;
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  return LAYOUT_SYMBOL.test(chord.key) || event.shiftKey === (chord.shift ?? false);
}

/** "Ctrl+Shift+X" on Windows/Linux, "⌘⇧X" on Mac: keys are not translated. */
export function formatChord(chord: Chord, mac: boolean): string {
  const key = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  const parts = [chord.mod ? (mac ? '⌘' : 'Ctrl') : '', chord.shift ? (mac ? '⇧' : 'Shift') : '', key].filter(Boolean);
  return parts.join(mac ? '' : '+');
}

/** The shortcut in `aria-keyshortcuts` format ("Control+Shift+X"): the screen reader says it apart from the name. */
export const ariaKeyShortcut = (chord: Chord, mac: boolean): string =>
  [chord.mod ? (mac ? 'Meta' : 'Control') : '', chord.shift ? 'Shift' : '', chord.key.length === 1 ? chord.key.toUpperCase() : chord.key]
    .filter(Boolean)
    .join('+');

export const isMacPlatform = (platform: string): boolean => /mac|iphone|ipad/i.test(platform);

/** Ctrl/Cmd+S: saves in the post editor and in the settings (useSaveShortcut). */
export const SAVE_CHORD: Chord = { key: 's', mod: true };

/**
 * Tab nests a list item, so inside a list focus could not leave the textarea with the keyboard (WCAG 2.1.2).
 * Esc and then Tab (or Shift+Tab) always lets it out; `previousKey` is the previous key in the textarea.
 */
export const tabLeavesEditor = (event: KeyLike, previousKey: string | null): boolean =>
  event.key === 'Tab' && previousKey === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey;

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

/** The "previous key" of tabLeavesEditor: pressing Shift to do Shift+Tab does not erase the Esc before it. */
export const rememberKey = (previous: string | null, key: string): string | null => (MODIFIER_KEYS.has(key) ? previous : key);

/** The registry action this key triggers (the first one, although a test keeps shortcuts unique). */
export const actionForKey = (event: KeyLike, actions: readonly EditorAction[]): EditorAction | undefined =>
  actions.find((action) => action.chord && matchesChord(event, action.chord));

/**
 * The text command of this key, or null to keep the native behavior. Shortcuts come from the action registry
 * (actions.ts), the same one that builds the toolbar, the palette and the help.
 */
export function commandForKey(event: KeyLike, lang: Lang = DEFAULT_LANG): Command | null {
  const run = actionForKey(event, editorActions(lang))?.run;
  return run && 'edit' in run ? run.edit : null;
}

import { DEFAULT_LANG, type Lang } from '../languages.ts';
import { editorActions, type EditorAction } from './actions.ts';
import type { Command } from './types.ts';

/** Subconjunto de KeyboardEvent que necesitamos (así se puede testear sin DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Una combinación de teclas. `mod` = Cmd en Mac, Ctrl en el resto. */
export interface Chord {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
}

// Un símbolo ("/") puede necesitar Shift según la distribución (en el teclado español es Shift+7): no se exige.
const LAYOUT_SYMBOL = /^[^\p{L}\p{N}]$/u;
const KEY_NAMES: Readonly<Record<string, string>> = { Escape: 'Esc' };

export function matchesChord(event: KeyLike, chord: Chord): boolean {
  // AltGr llega como Ctrl+Alt en Windows: con Alt nunca hay atajo, así se pueden escribir @, # o |.
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) !== (chord.mod ?? false)) return false;
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  return LAYOUT_SYMBOL.test(chord.key) || event.shiftKey === (chord.shift ?? false);
}

/** "Ctrl+Shift+X" en Windows/Linux, "⌘⇧X" en Mac: las teclas no se traducen. */
export function formatChord(chord: Chord, mac: boolean): string {
  const key = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  const parts = [chord.mod ? (mac ? '⌘' : 'Ctrl') : '', chord.shift ? (mac ? '⇧' : 'Shift') : '', key].filter(Boolean);
  return parts.join(mac ? '' : '+');
}

export const isMacPlatform = (platform: string): boolean => /mac|iphone|ipad/i.test(platform);

/** La acción del registro que dispara esta tecla (la primera, aunque los atajos son únicos por test). */
export const actionForKey = (event: KeyLike, actions: readonly EditorAction[]): EditorAction | undefined =>
  actions.find((action) => action.chord && matchesChord(event, action.chord));

/**
 * El comando de texto de esta tecla, o null para dejar el comportamiento nativo. Los atajos salen del registro de
 * acciones (actions.ts), el mismo que arma la barra, la paleta y la ayuda.
 */
export function commandForKey(event: KeyLike, lang: Lang = DEFAULT_LANG): Command | null {
  const run = actionForKey(event, editorActions(lang))?.run;
  return run && 'edit' in run ? run.edit : null;
}

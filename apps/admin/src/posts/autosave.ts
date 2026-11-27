import type { I18n } from '../i18n/i18n.ts';

/*
 * Autosave. Only drafts that already exist:
 * - Not a published post: saving it rebuilds the site, so every typing pause would publish half-done work.
 * - Not a new one either: the first save creates it and fixes its language, which is chosen beforehand.
 * It goes through the same `save` as the Guardar button; it never publishes.
 */

/** Idle time before saving on its own. */
export const AUTOSAVE_DELAY_MS = 3000;

export interface AutosaveInput {
  exists: boolean;
  published: boolean;
  title: string;
  dirty: boolean;
  /** A save (automatic or manual) in progress: never two requests at once. */
  saving: boolean;
}

/** Without a title the save fails (it is required): it is not attempted so an error does not show on every pause. */
export const canAutosave = ({ exists, published, title, dirty, saving }: AutosaveInput): boolean =>
  exists && !published && dirty && !saving && title.trim() !== '';

/** The last save of this visit (automatic or manual). */
export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error' };

export interface SaveStatusInput {
  state: SaveState;
  dirty: boolean;
  exists: boolean;
  published: boolean;
}

/** The header indicator: Guardando… / Guardado hh:mm / No se pudo guardar / Cambios sin guardar. */
export function saveStatusText({ state, dirty, exists, published }: SaveStatusInput, { t, formatTime }: I18n): string {
  if (state.kind === 'saving') return t('common.saving');
  if (state.kind === 'error') return t('autosave.error');
  if (dirty) return published ? t('autosave.manual') : t('common.unsaved');
  if (state.kind === 'saved') return t('autosave.savedAt', { time: formatTime(state.at) });
  return exists ? t('common.allSaved') : '';
}

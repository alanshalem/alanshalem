import type { I18n } from '../i18n/i18n.ts';

/*
 * Guardado automático (S3). Solo borradores que ya existen:
 * - Un post publicado no: guardarlo regenera el sitio, así que cada pausa al escribir publicaría a medias.
 * - Uno nuevo tampoco: el primer guardado lo crea y fija su idioma (L4), que se elige antes.
 * Pasa por el mismo `save` que el botón Guardar; nunca publica.
 */

/** Segundos sin tocar nada antes de guardar solo. */
export const AUTOSAVE_DELAY_MS = 3000;

export interface AutosaveInput {
  exists: boolean;
  published: boolean;
  title: string;
  dirty: boolean;
  /** Un guardado (automático o manual) en curso: nunca dos pedidos a la vez. */
  saving: boolean;
}

/** Sin título el guardado falla (es obligatorio): no se intenta solo para no mostrar un error a cada pausa. */
export const canAutosave = ({ exists, published, title, dirty, saving }: AutosaveInput): boolean =>
  exists && !published && dirty && !saving && title.trim() !== '';

/** El último guardado de esta visita (automático o manual). */
export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error' };

export interface SaveStatusInput {
  state: SaveState;
  dirty: boolean;
  exists: boolean;
  published: boolean;
}

/** El indicador de la cabecera: Guardando… / Guardado hh:mm / No se pudo guardar / Cambios sin guardar. */
export function saveStatusText({ state, dirty, exists, published }: SaveStatusInput, { t, formatTime }: I18n): string {
  if (state.kind === 'saving') return t('common.saving');
  if (state.kind === 'error') return t('autosave.error');
  if (dirty) return published ? t('autosave.manual') : t('common.unsaved');
  if (state.kind === 'saved') return t('autosave.savedAt', { time: formatTime(state.at) });
  return exists ? t('common.allSaved') : '';
}

import type { PostInput } from '../api/types.ts';
import type { Translate } from '../i18n/i18n.ts';
import { collapseUnchanged, diffLines, type DiffChunk } from './lineDiff.ts';

/*
 * Historial de versiones (S5, L4): cada guardado que cambia el contenido es una versión; restaurar guarda esa versión
 * como la actual (y queda como una versión más: la historia no se borra). La API no compara: compara el admin, contra
 * lo que se ve en el editor, que es lo que la restauración reemplaza.
 */

/** Las versiones que conserva la API por post (`PostRevision.MaxPerPost`): las más viejas se podan. */
export const MAX_REVISIONS = 50;

/** Los campos que se comparan uno a uno; el cuerpo va aparte, como diff de líneas. */
export type ContentField = 'title' | 'slug' | 'summary' | 'tags' | 'coverUrl' | 'coverAlt';

const FIELDS: readonly ContentField[] = ['title', 'slug', 'summary', 'tags', 'coverUrl', 'coverAlt'];

export interface FieldChange {
  readonly field: ContentField;
  readonly before: string;
  readonly after: string;
}

export interface RevisionComparison {
  readonly fields: readonly FieldChange[];
  readonly bodyChanged: boolean;
  /** El diff del cuerpo, con las líneas iguales lejos de los cambios resumidas. */
  readonly body: readonly DiffChunk[];
  /** Restaurar no cambiaría nada de lo que se ve. */
  readonly identical: boolean;
}

/**
 * Un campo como lo deja el guardado (sin espacios en los bordes, sin portada = vacío): así un espacio que la API iba
 * a recortar, o `''` contra `null`, no aparecen como diferencias.
 */
const fieldText = (content: PostInput, field: ContentField): string => {
  const value = content[field];
  return (Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
};

/** De la versión (`revision`) a lo que se está editando (`current`). */
export function compareRevision(revision: PostInput, current: PostInput): RevisionComparison {
  const fields = FIELDS.map((field) => ({ field, before: fieldText(revision, field), after: fieldText(current, field) })).filter(
    (change) => change.before !== change.after,
  );
  const bodyChanged = revision.body !== current.body;
  return {
    fields,
    bodyChanged,
    body: collapseUnchanged(diffLines(revision.body, current.body)),
    identical: fields.length === 0 && !bodyChanged,
  };
}

/**
 * La pregunta antes de restaurar. Con cambios sin guardar avisa que se pierden (lo mismo que el guardia de salida,
 * `useUnsavedGuard`); sin cambios, lo guardado no se pierde: queda en el historial.
 */
export const restoreConfirmation = (number: number, dirty: boolean, t: Translate): string =>
  t(dirty ? 'history.confirmRestoreUnsaved' : 'history.confirmRestore', { number });

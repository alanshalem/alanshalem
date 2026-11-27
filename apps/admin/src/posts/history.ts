import type { PostInput } from '../api/types.ts';
import type { Translate } from '../i18n/i18n.ts';
import { collapseUnchanged, diffLines, type DiffChunk } from './lineDiff.ts';

/*
 * Revision history: every save that changes the content is a revision; restoring saves that revision as the current
 * one (and it becomes one more revision: history is never erased). The API does not compare: the admin does, against
 * what the editor shows, which is what the restore replaces.
 */

/** The revisions the API keeps per post (`PostRevision.MaxPerPost`): the oldest are pruned. */
export const MAX_REVISIONS = 50;

/** The fields compared one by one; the body goes separately, as a line diff. */
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
  /** The body diff, with equal lines far from the changes collapsed. */
  readonly body: readonly DiffChunk[];
  /** Restoring would change nothing visible. */
  readonly identical: boolean;
}

/**
 * A field as the save leaves it (no edge spaces, no cover = empty): so a space the API would trim, or `''` versus
 * `null`, do not show up as differences.
 */
const fieldText = (content: PostInput, field: ContentField): string => {
  const value = content[field];
  return (Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
};

/** From the revision (`revision`) to what is being edited (`current`). */
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
 * The question before restoring. With unsaved changes it warns they are lost (same as the leave guard,
 * `useUnsavedGuard`); without changes, nothing saved is lost: it stays in the history.
 */
export const restoreConfirmation = (number: number, dirty: boolean, t: Translate): string =>
  t(dirty ? 'history.confirmRestoreUnsaved' : 'history.confirmRestore', { number });

import { useId, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../api/problem.ts';
import type { Post, PostInput } from '../api/types.ts';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { compareRevision, MAX_REVISIONS, restoreConfirmation } from './history.ts';
import { RevisionDiff } from './RevisionDiff.tsx';
import { usePostHistory } from './usePostHistory.ts';

interface Props {
  post: Post;
  /** What the editor shows: the comparison is against it (it is what the restore replaces). */
  current: PostInput;
  dirty: boolean;
  /** A save or another action in progress: restoring waits. */
  busy: boolean;
  /** Restores in the API and reloads the post in the editor; null if it could not start (another action in progress). */
  onRestore: (revisionId: string) => Promise<Post | null>;
  onError: (error: unknown) => boolean;
}

/** Revision history: the list of saves, the diff of the chosen one against the current state and "Restaurar". */
export function HistoryPanel({ post, current, dirty, busy, onRestore, onError }: Props) {
  const id = useId();
  const { t, plural, formatDateTime } = useUiLanguage();
  const history = usePostHistory(post.id, post.contentUpdatedAt, onError);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { revision, revisions } = history;
  const comparison = useMemo(() => revision && compareRevision(revision, current), [revision, current]);
  // While the chosen revision loads, the heading comes from the list row.
  const shown = revision ?? revisions?.find((candidate) => candidate.id === history.selectedId) ?? null;

  const select = (revisionId: string): void => {
    setStatus('');
    setError(null);
    history.select(revisionId);
  };

  const restore = async (): Promise<void> => {
    if (!revision || !window.confirm(restoreConfirmation(revision.number, dirty, t))) return;
    setStatus('');
    setError(null);
    setRestoring(true);
    try {
      if (await onRestore(revision.id)) {
        setStatus(t('history.restored', { number: revision.number }));
        // The button goes away (the revision now equals the current state): focus goes to the comparison heading.
        headingRef.current?.focus();
      }
    } catch (caught) {
      // The API message as is (a slug 409, for example), already in the UI language.
      if (!onError(caught)) setError(errorMessage(caught, t('history.restoreError')));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ToolPanel title={t('history.title')} defaultOpen={false} onToggle={(open) => open && history.open()}>
      <p className="help">{t('history.help', { max: MAX_REVISIONS })}</p>
      {history.loadFailed && (
        <p className="field-error" role="alert">
          {t('history.loadError')}
        </p>
      )}
      {revisions === null && !history.loadFailed && <p className="help">{t('common.loading')}</p>}
      {revisions?.length === 0 && <p className="help">{t('history.none')}</p>}

      {revisions && revisions.length > 0 && (
        <div className="history">
          <ul className="tool-list history-list" aria-label={t('history.versions')}>
            {revisions.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="tool-link history-item"
                  aria-current={item.id === history.selectedId ? 'true' : undefined}
                  onClick={() => select(item.id)}
                >
                  <span className="tool-where">{t('history.revision', { number: item.number })}</span>
                  <span className="history-item-text">
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    <span>{item.title || t('common.untitled')}</span>
                    <span className="meta">{plural(item.bodyLength, 'stats.characters')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {shown && (
            <section className="history-compare" aria-labelledby={`${id}-compare`}>
              <h3 id={`${id}-compare`} ref={headingRef} className="history-heading" tabIndex={-1}>
                {t('history.compare', { number: shown.number, date: formatDateTime(shown.createdAt) })}
              </h3>
              {history.revisionFailed ? (
                <p className="field-error" role="alert">
                  {t('history.revisionLoadError')}
                </p>
              ) : comparison ? (
                <>
                  <RevisionDiff number={shown.number} comparison={comparison} />
                  {!comparison.identical && (
                    <button type="button" className="history-restore" disabled={busy} onClick={() => void restore()}>
                      {restoring ? t('history.restoring') : t('history.restore')}
                    </button>
                  )}
                </>
              ) : (
                <p className="help">{t('history.loadingRevision', { number: shown.number })}</p>
              )}
            </section>
          )}
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {/* Always present: a live region that appears together with its text is not always announced. */}
      <p className="field-status" role="status">
        {status}
      </p>
    </ToolPanel>
  );
}

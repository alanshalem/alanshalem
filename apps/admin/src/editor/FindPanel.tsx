import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { FindState } from './useFind.ts';

/** Panel buscar/reemplazar (Ctrl+F / Ctrl+H). Solo presenta: el estado y las acciones vienen de useFind. */
export function FindPanel({ find }: { find: FindState }) {
  const { t, plural } = useUiLanguage();
  const queryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [find.focusToken]);

  const onQueryKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) find.previous();
    else find.next();
  };

  const onReplaceKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    find.replaceOne();
  };

  const count = find.total === 0 ? t('find.none') : t('find.count', { current: find.current + 1, total: find.total });
  const noMatches = find.query !== '' && find.total === 0;

  return (
    <div className="find-panel" role="search">
      <div className="find-row">
        <input
          ref={queryRef}
          type="search"
          aria-label={t('find.query')}
          placeholder={t('find.query')}
          value={find.query}
          aria-invalid={noMatches}
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={onQueryKey}
        />
        <span className="find-count" aria-live="polite">
          {find.query && count}
        </span>
        <button type="button" className="toolbar-button" title={t('find.previous')} aria-label={t('find.previous')} onClick={find.previous}>
          ↑
        </button>
        <button type="button" className="toolbar-button" title={t('find.next')} aria-label={t('find.next')} onClick={find.next}>
          ↓
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={find.options.caseSensitive}
          title={t('find.caseSensitive')}
          aria-label={t('find.caseSensitive')}
          onClick={() => find.toggleOption('caseSensitive')}
        >
          Aa
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={find.options.wholeWord}
          title={t('find.wholeWord')}
          aria-label={t('find.wholeWord')}
          onClick={() => find.toggleOption('wholeWord')}
        >
          «ab»
        </button>
        <button type="button" className="ghost" onClick={find.close}>
          {t('common.close')}
        </button>
      </div>
      {find.mode === 'replace' && (
        <div className="find-row">
          <input
            aria-label={t('find.replacement')}
            placeholder={t('find.replacement')}
            value={find.replacement}
            onChange={(event) => find.setReplacement(event.target.value)}
            onKeyDown={onReplaceKey}
          />
          <button type="button" disabled={find.total === 0} onClick={find.replaceOne}>
            {t('find.replaceOne')}
          </button>
          <button type="button" disabled={find.total === 0} onClick={find.replaceAll}>
            {t('find.replaceAll')}
          </button>
          <span className="find-count" role="status">
            {find.replacedCount !== null && plural(find.replacedCount, 'find.replaced')}
          </span>
        </div>
      )}
    </div>
  );
}

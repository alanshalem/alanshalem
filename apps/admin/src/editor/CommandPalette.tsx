import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { type EditorAction } from './actions.ts';
import { fuzzyFilter } from './fuzzy.ts';
import { Modal } from './Modal.tsx';
import { formatChord } from './shortcuts.ts';

interface Props {
  actions: readonly EditorAction[];
  mac: boolean;
  onRun: (action: EditorAction) => void;
  onClose: () => void;
}

/** Ctrl+P: every registry action with fuzzy search. Combobox + listbox (ARIA pattern). */
export function CommandPalette({ actions, mac, onRun, onClose }: Props) {
  const { t } = useUiLanguage();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // After the Modal's showModal() (the child's effects run first), which focuses the first button; before painting.
  useLayoutEffect(() => inputRef.current?.focus(), []);
  const found = useMemo(() => fuzzyFilter(actions, query, (action) => t(action.label)), [actions, query, t]);
  const activeAction = found[Math.min(active, found.length - 1)];

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const move = moves[event.key];
    if (move !== undefined && found.length > 0) {
      event.preventDefault();
      setActive((index) => (Math.min(index, found.length - 1) + move + found.length) % found.length);
    } else if (event.key === 'Enter' && activeAction) {
      event.preventDefault();
      onRun(activeAction);
    }
  };

  return (
    <Modal title={t('editor.palette')} onClose={onClose} className="palette">
      <input
        ref={inputRef}
        className="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeAction ? `${listId}-${activeAction.id}` : undefined}
        aria-label={t('palette.search')}
        placeholder={t('palette.search')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} className="palette-list" role="listbox" aria-label={t('editor.palette')}>
        {found.map((action) => (
          <li
            key={action.id}
            id={`${listId}-${action.id}`}
            role="option"
            aria-selected={action === activeAction}
            onMouseMove={() => setActive(found.indexOf(action))}
            onClick={() => onRun(action)}
          >
            <span>{t(action.label)}</span>
            {action.chord && <kbd>{formatChord(action.chord, mac)}</kbd>}
          </li>
        ))}
      </ul>
      {found.length === 0 && <p className="help">{t('palette.empty')}</p>}
    </Modal>
  );
}

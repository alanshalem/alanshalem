import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { toolbarLabels, type ActionGroup, type EditorAction } from './actions.ts';
import { rovingIndex } from './roving.ts';
import { ariaKeyShortcut, formatChord } from './shortcuts.ts';

interface Props {
  actions: readonly EditorAction[];
  mac: boolean;
  /** For buttons that are a state (the current view, focus mode): aria-pressed. */
  isPressed: (action: EditorAction) => boolean | undefined;
  onRun: (action: EditorAction) => void;
}

// View and tools go on the right, apart from the formatting.
const END_GROUPS: ReadonlySet<ActionGroup> = new Set(['view', 'tools']);

/**
 * The editor toolbar: the buttons come from the registry, with a separator between groups. It is a single Tab stop
 * (roving tabindex: the last used button has tabIndex 0) and is walked with the arrows, Home and End (roving.ts).
 */
export function EditorToolbar({ actions, mac, isPressed, onRun }: Props) {
  const { t } = useUiLanguage();
  const buttons = actions.filter((action) => action.toolbar);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // The buttons change with the context (uploading images, viewing the original): the active one is never left out.
  const current = Math.min(active, buttons.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingIndex(event.nativeEvent, current, buttons.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="editor-toolbar" role="toolbar" aria-label={t('editor.format')} onKeyDown={handleKeyDown}>
      {buttons.map((action, index) => {
        const previous = buttons[index - 1];
        const { face, name } = toolbarLabels(action, t);
        const full = t(action.label);
        // The tooltip keeps the long description and the shortcut; the accessible name starts with the visible text (2.5.3).
        const title = action.chord ? `${full} (${formatChord(action.chord, mac)})` : full;
        const startsEnd = END_GROUPS.has(action.group) && (!previous || !END_GROUPS.has(previous.group));
        return (
          <Fragment key={action.id}>
            {startsEnd ? (
              <span className="toolbar-spacer" aria-hidden="true" />
            ) : (
              previous && previous.group !== action.group && <span className="toolbar-separator" aria-hidden="true" />
            )}
            <button
              ref={(button) => {
                refs.current[index] = button;
              }}
              type="button"
              className="toolbar-button"
              tabIndex={index === current ? 0 : -1}
              title={title}
              aria-label={name}
              aria-keyshortcuts={action.chord ? ariaKeyShortcut(action.chord, mac) : undefined}
              aria-pressed={isPressed(action)}
              onFocus={() => setActive(index)}
              onClick={() => onRun(action)}
            >
              {face}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

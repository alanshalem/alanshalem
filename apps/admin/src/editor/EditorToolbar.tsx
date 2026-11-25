import { Fragment } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { ActionGroup, EditorAction } from './actions.ts';
import { formatChord } from './shortcuts.ts';

interface Props {
  actions: readonly EditorAction[];
  mac: boolean;
  /** Para los botones que son un estado (la vista actual, el modo foco): aria-pressed. */
  isPressed: (action: EditorAction) => boolean | undefined;
  onRun: (action: EditorAction) => void;
}

// Vista y herramientas van a la derecha, separadas del formato.
const END_GROUPS: ReadonlySet<ActionGroup> = new Set(['view', 'tools']);

/** La barra del editor: los botones salen del registro, con un separador entre grupos. */
export function EditorToolbar({ actions, mac, isPressed, onRun }: Props) {
  const { t } = useUiLanguage();
  const buttons = actions.filter((action) => action.toolbar);

  return (
    <div className="editor-toolbar" role="toolbar" aria-label={t('editor.format')}>
      {buttons.map((action, index) => {
        const previous = buttons[index - 1];
        const name = t(action.label);
        const title = action.chord ? `${name} (${formatChord(action.chord, mac)})` : name;
        const startsEnd = END_GROUPS.has(action.group) && (!previous || !END_GROUPS.has(previous.group));
        return (
          <Fragment key={action.id}>
            {startsEnd ? (
              <span className="toolbar-spacer" aria-hidden="true" />
            ) : (
              previous && previous.group !== action.group && <span className="toolbar-separator" aria-hidden="true" />
            )}
            <button
              type="button"
              className="toolbar-button"
              title={title}
              aria-label={title}
              aria-pressed={isPressed(action)}
              onClick={() => onRun(action)}
            >
              {action.symbol ?? t(action.short ?? action.label)}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

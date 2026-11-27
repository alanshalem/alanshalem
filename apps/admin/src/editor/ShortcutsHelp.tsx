import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { ActionGroup, EditorAction } from './actions.ts';
import { Modal } from './Modal.tsx';
import { formatChord } from './shortcuts.ts';

interface Props {
  actions: readonly EditorAction[];
  mac: boolean;
  onClose: () => void;
}

/** Ctrl+/: the shortcuts come from the same registry as the toolbar and the palette, grouped as in the toolbar. */
export function ShortcutsHelp({ actions, mac, onClose }: Props) {
  const { t } = useUiLanguage();
  const groups = new Map<ActionGroup, EditorAction[]>();
  for (const action of actions) {
    if (action.chord) groups.set(action.group, [...(groups.get(action.group) ?? []), action]);
  }

  return (
    <Modal title={t('editor.help')} onClose={onClose} className="shortcuts">
      <div className="shortcuts-groups">
        {[...groups].map(([group, items]) => (
          <section key={group}>
            <h3 className="label">{t(`editor.group.${group}`)}</h3>
            <dl>
              {items.map((action) => (
                <div key={action.id} className="shortcut-row">
                  <dt>{t(action.label)}</dt>
                  <dd>
                    <kbd>{formatChord(action.chord!, mac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {/* Tab nests lists: how to leave the editor with the keyboard (WCAG 2.1.2). */}
      <p className="help shortcuts-note">{t('editor.tabHint')}</p>
    </Modal>
  );
}

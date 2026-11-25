import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { ActionGroup, EditorAction } from './actions.ts';
import { Modal } from './Modal.tsx';
import { formatChord } from './shortcuts.ts';

interface Props {
  actions: readonly EditorAction[];
  mac: boolean;
  onClose: () => void;
}

/** Ctrl+/ (S2): los atajos salen del mismo registro que la barra y la paleta, agrupados como en la barra. */
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
    </Modal>
  );
}

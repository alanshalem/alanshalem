import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { OutlineEntry } from './preview.ts';

interface Props {
  entries: readonly OutlineEntry[];
  onSelect: (entry: OutlineEntry) => void;
}

// Las secciones (`##`, y un `#` del cuerpo) salen como <h2> (el título del post es el <h1>): ese nivel va sin sangría.
const TOP_LEVEL = 2;

/** Esquema de títulos (S3): cada uno lleva el editor y la vista previa a su sección. */
export function OutlinePanel({ entries, onSelect }: Props) {
  const { t } = useUiLanguage();
  return (
    <ToolPanel title={t('tools.outline')}>
      {entries.length === 0 ? (
        <p className="help">{t('tools.outlineEmpty')}</p>
      ) : (
        <nav aria-label={t('tools.outline')}>
          <ol className="tool-list">
            {entries.map((entry) => (
              <li key={entry.id} style={{ paddingInlineStart: `${entry.level - TOP_LEVEL}rem` }}>
                <button type="button" className="tool-link" onClick={() => onSelect(entry)}>
                  {entry.text || t('common.untitled')}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </ToolPanel>
  );
}

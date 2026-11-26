import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { describeIssue, type LintIssue, type LintTarget } from './lint.ts';

interface Props {
  issues: readonly LintIssue[];
  /** Ir a la línea del editor o al campo del aviso. */
  onSelect: (target: LintTarget) => void;
}

/** Revisor del post (S3): la lista de avisos; cada uno lleva a donde está el problema. */
export function ReviewPanel({ issues, onSelect }: Props) {
  const i18n = useUiLanguage();
  const count = issues.length === 0 ? i18n.t('tools.reviewClean') : i18n.plural(issues.length, 'tools.reviewCount');

  return (
    <ToolPanel
      title={i18n.t('tools.review')}
      // Región viva: el lector de pantalla anuncia cuando cambia la cuenta, sin tener que abrir el panel.
      badge={
        <span className={issues.length > 0 ? 'chip chip-warning' : 'chip chip-published'} role="status">
          {count}
        </span>
      }
    >
      {issues.length > 0 && (
        <ul className="tool-list">
          {issues.map((issue, index) => {
            const { where, message } = describeIssue(issue, i18n);
            return (
              // Los avisos no tienen id propio y la lista se recalcula entera: el índice alcanza.
              <li key={index}>
                <button type="button" className="tool-link" onClick={() => onSelect(issue.target)}>
                  <span className="tool-where">{where}</span> {message}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ToolPanel>
  );
}

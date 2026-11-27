import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { describeIssue, type LintIssue, type LintTarget } from './lint.ts';

interface Props {
  issues: readonly LintIssue[];
  /** Go to the editor line or the field of the warning. */
  onSelect: (target: LintTarget) => void;
}

/** The post reviewer: the list of warnings; each one leads to where the problem is. */
export function ReviewPanel({ issues, onSelect }: Props) {
  const i18n = useUiLanguage();
  const count = issues.length === 0 ? i18n.t('tools.reviewClean') : i18n.plural(issues.length, 'tools.reviewCount');

  return (
    <ToolPanel
      title={i18n.t('tools.review')}
      // Live region: the screen reader announces when the count changes, without opening the panel.
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
              // Warnings have no id of their own and the list is recomputed whole: the index is enough.
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

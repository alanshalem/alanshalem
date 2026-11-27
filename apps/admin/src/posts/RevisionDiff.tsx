import { useId } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { RevisionComparison } from './history.ts';
import type { DiffKind } from './lineDiff.ts';

interface Props {
  /** The number of the compared revision: it names what is only in it. */
  number: number;
  comparison: RevisionComparison;
}

// The sign is text, not only color (WCAG 1.4.1); the typographic minus stands out better than a hyphen.
const SIGNS: Record<DiffKind, string> = { removed: '−', added: '+', same: ' ' };

interface LineProps {
  kind: DiffKind;
  text: string;
  /** What a screen reader says before the line ("Solo en la versión 3"); the sign is hidden. */
  label?: string;
}

function DiffRow({ kind, text, label }: LineProps) {
  // <del>/<ins>: the "removed/added" semantics besides the sign and the color.
  const Tag = kind === 'removed' ? 'del' : kind === 'added' ? 'ins' : 'span';
  return (
    <Tag className={`diff-line diff-${kind}`}>
      <span className="diff-sign" aria-hidden="true">
        {SIGNS[kind]}
      </span>
      {label && <span className="visually-hidden">{label}: </span>}
      {/* A space keeps the height of an empty line. */}
      {text || ' '}
    </Tag>
  );
}

/** What changes between a revision and what is being edited: the differing fields and the text's line diff. */
export function RevisionDiff({ number, comparison }: Props) {
  const id = useId();
  const { t, plural } = useUiLanguage();
  if (comparison.identical) return <p className="help">{t('history.identical')}</p>;

  const labels: Record<DiffKind, string | undefined> = {
    removed: t('history.onlyInRevision', { number }),
    added: t('history.onlyInCurrent'),
    same: undefined,
  };

  return (
    <div className="diff">
      <p className="diff-legend">
        <span className="diff-line diff-removed">
          <span className="diff-sign">{SIGNS.removed}</span>
          {labels.removed}
        </span>
        <span className="diff-line diff-added">
          <span className="diff-sign">{SIGNS.added}</span>
          {labels.added}
        </span>
      </p>

      {comparison.fields.length > 0 && (
        <dl className="diff-fields">
          {comparison.fields.map(({ field, before, after }) => (
            <div key={field}>
              <dt className="label">{t(`history.field.${field}`)}</dt>
              <dd>
                <DiffRow kind="removed" text={before || t('history.emptyValue')} label={labels.removed} />
                <DiffRow kind="added" text={after || t('history.emptyValue')} label={labels.added} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {comparison.bodyChanged && (
        <>
          <p className="label" id={`${id}-body`}>
            {t('history.field.body')}
          </p>
          {/* With its own scroll: tabIndex and a name so it can be walked with the keyboard (WCAG 2.1.1). */}
          <div className="diff-body" role="region" aria-labelledby={`${id}-body`} tabIndex={0}>
            {comparison.body.map((chunk, index) =>
              chunk.kind === 'skipped' ? (
                <p key={index} className="diff-skipped">
                  {plural(chunk.count, 'history.skipped')}
                </p>
              ) : (
                // Runs have no id of their own and the diff is recomputed whole: the index is enough.
                <div key={index}>
                  {chunk.lines.map((line, lineIndex) => (
                    <DiffRow key={lineIndex} kind={line.kind} text={line.text} label={labels[line.kind]} />
                  ))}
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

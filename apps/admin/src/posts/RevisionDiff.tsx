import { useId } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { RevisionComparison } from './history.ts';
import type { DiffKind } from './lineDiff.ts';

interface Props {
  /** El número de la versión comparada: nombra lo que solo está en ella. */
  number: number;
  comparison: RevisionComparison;
}

// El signo es texto, no solo color (WCAG 1.4.1); el menos tipográfico se distingue mejor que un guion.
const SIGNS: Record<DiffKind, string> = { removed: '−', added: '+', same: ' ' };

interface LineProps {
  kind: DiffKind;
  text: string;
  /** Lo que dice un lector de pantalla antes de la línea ("Solo en la versión 3"); el signo se oculta. */
  label?: string;
}

function DiffRow({ kind, text, label }: LineProps) {
  // <del>/<ins>: la semántica de "quitado/agregado" además del signo y el color.
  const Tag = kind === 'removed' ? 'del' : kind === 'added' ? 'ins' : 'span';
  return (
    <Tag className={`diff-line diff-${kind}`}>
      <span className="diff-sign" aria-hidden="true">
        {SIGNS[kind]}
      </span>
      {label && <span className="visually-hidden">{label}: </span>}
      {/* Un espacio mantiene el alto de una línea vacía. */}
      {text || ' '}
    </Tag>
  );
}

/** Qué cambia entre una versión y lo que se está editando: los campos distintos y el diff de líneas del texto. */
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
          {/* Con scroll propio: tabIndex y nombre para que se pueda recorrer con el teclado (WCAG 2.1.1). */}
          <div className="diff-body" role="region" aria-labelledby={`${id}-body`} tabIndex={0}>
            {comparison.body.map((chunk, index) =>
              chunk.kind === 'skipped' ? (
                <p key={index} className="diff-skipped">
                  {plural(chunk.count, 'history.skipped')}
                </p>
              ) : (
                // Los tramos no tienen id propio y el diff se recalcula entero: el índice alcanza.
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

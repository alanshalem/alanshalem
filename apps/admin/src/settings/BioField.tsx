import { renderMarkdown } from '@blog/markdown';
import { useDeferredValue, useMemo } from 'react';
import type { Lang } from '../languages.ts';
import { LIMITS } from './validate.ts';

interface Props {
  /** Clave del ajuste; también arma el id del campo (`settings-bio`), al que va el foco si tiene error. */
  name: 'bio' | 'bioEn';
  label: string;
  /** Idioma del texto: el corrector ortográfico del navegador usa el correcto. */
  lang: Lang;
  value: string;
  error: string | undefined;
  hint?: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Bio en Markdown con su vista previa al lado, tal como la muestra el sitio. Una por idioma. */
export function BioField({ name, label, lang, value, error, hint, placeholder, onChange }: Props) {
  const id = `settings-${name}`;
  // Diferido: renderizar el Markdown no frena el tipeo.
  const deferred = useDeferredValue(value);
  const html = useMemo(() => renderMarkdown(deferred, { headingOffset: 2 }).html, [deferred]);
  const describedBy = [error ? `${id}-error` : null, `${id}-count`, hint ? `${id}-hint` : null].filter(Boolean).join(' ');

  return (
    <div className="bio-editor">
      <div className="field">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className="bio-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={9}
          maxLength={LIMITS.bio}
          lang={lang}
          spellCheck
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
        />
        <p id={`${id}-count`} className="help">
          {value.length} / {LIMITS.bio}
        </p>
        {hint && (
          <p id={`${id}-hint`} className="help">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
      <div className="field">
        <span className="label" id={`${id}-preview`}>
          Vista previa
        </span>
        <div className="paper bio-preview" aria-labelledby={`${id}-preview`}>
          {value.trim() === '' ? (
            <p className="bio-preview-empty">Sin bio todavía.</p>
          ) : (
            <div className="prose" lang={lang} dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}

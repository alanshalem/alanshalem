import { renderMarkdown } from '@blog/markdown';
import { useDeferredValue, useMemo } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { LIMITS } from '../limits.ts';

interface Props {
  /** The setting's key; it also builds the field id (`settings-bio`), which gets focus on error. */
  name: 'bio' | 'bioEn';
  label: string;
  /** The text's language: the browser's spell checker uses the right one. */
  lang: Lang;
  value: string;
  error: string | undefined;
  hint?: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Markdown bio with its preview alongside, as the site shows it. One per language. */
export function BioField({ name, label, lang, value, error, hint, placeholder, onChange }: Props) {
  const { t } = useUiLanguage();
  const id = `settings-${name}`;
  // Deferred: rendering the Markdown does not slow typing.
  const deferred = useDeferredValue(value);
  const html = useMemo(() => renderMarkdown(deferred, { headingOffset: 2 }).html, [deferred]);
  const describedBy = [error ? `${id}-error` : null, `${id}-count`, hint ? `${id}-hint` : null].filter(Boolean).join(' ');

  return (
    <div className="bio-editor">
      <div className="field">
        <label className="label" id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className="bio-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={9}
          maxLength={LIMITS.settings.bio}
          lang={lang}
          spellCheck
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
        />
        <p id={`${id}-count`} className="help">
          {value.length} / {LIMITS.settings.bio}
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
          {t('common.preview')}
        </span>
        {/* Region with its own name ("Vista previa Bio en inglés"): there is one per language and they do not mix up. */}
        <div className="paper bio-preview" role="region" aria-labelledby={`${id}-preview ${id}-label`}>
          {value.trim() === '' ? (
            <p className="bio-preview-empty">{t('settings.bioEmpty')}</p>
          ) : (
            <div className="prose" lang={lang} dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}

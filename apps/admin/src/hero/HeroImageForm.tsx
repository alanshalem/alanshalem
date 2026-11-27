import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../api/problem.ts';
import type { HeroImageInput } from '../api/types.ts';
import type { MessageKey } from '../i18n/i18n.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import {
  HERO_IMAGE_LIMITS,
  toHeroImageFields,
  validateHeroImage,
  type HeroImageErrors,
  type HeroImageFields,
} from './heroImage.ts';

interface Props {
  /** What goes above the fields (title and status of a file in progress, or a video's trim summary). */
  head?: ReactNode;
  /** The id of the heading that names the form, if any. */
  labelledBy?: string | undefined;
  /** Saved values; without them it is a new item. */
  saved?: HeroImageInput | undefined;
  /** false while the file is still queued or uploading (there is no asset to attach the text to yet). */
  canSave?: boolean | undefined;
  /** Error from outside the form (the size check, the upload or the video processing). */
  error?: string | null | undefined;
  /** Non-blocking warnings (below the ideal size), already in the UI language. */
  warnings?: readonly string[] | undefined;
  saveLabel: string;
  onSave: (input: HeroImageInput) => Promise<void>;
  remove: { label: string; tone: 'ghost' | 'danger'; onClick: () => Promise<void> | void };
  /** Reports whether there are unsaved changes (the side panel asks before closing or moving to another item). */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Announced on save and visible until the next change (in the panel: the page's notice is inert). */
  doneText?: string | undefined;
}

// Each alt text next to its English version; the credit is a single field. The English field's example is in English:
// it shows what to write there, in any UI language.
const FIELDS: readonly { key: keyof HeroImageInput; label: MessageKey; placeholder: MessageKey }[] = [
  { key: 'alt', label: 'image.alt', placeholder: 'hero.altPlaceholder' },
  { key: 'altEn', label: 'hero.altEn', placeholder: 'hero.altEnPlaceholder' },
  { key: 'credit', label: 'hero.credit', placeholder: 'hero.creditPlaceholder' },
];

/**
 * The texts of a hero item (Spanish and English alt text and credit) with Guardar and Eliminar/Descartar.
 * Used by the card of a file in progress (POST) and the side panel of a saved item (PUT): the form is not duplicated.
 * It is its own <form>: Enter saves that item and nothing else.
 */
export function HeroImageForm({
  head,
  labelledBy,
  saved,
  canSave = true,
  error,
  warnings = [],
  saveLabel,
  onSave,
  remove,
  onDirtyChange,
  doneText,
}: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const id = useId();
  const [fields, setFields] = useState<HeroImageFields>(() => toHeroImageFields(saved));
  const [errors, setErrors] = useState<HeroImageErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState<'save' | 'remove' | null>(null);
  const [done, setDone] = useState(false);

  const changed = saved === undefined || JSON.stringify(fields) !== JSON.stringify(toHeroImageFields(saved));
  const dirty = saved !== undefined && changed;
  const problem = error ?? failure;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // One action at a time; the API message (ProblemDetails) stays in the form.
  const run = async (kind: 'save' | 'remove', action: () => Promise<void> | void): Promise<void> => {
    setRunning(kind);
    setFailure(null);
    try {
      await action();
    } catch (caught) {
      setFailure(errorMessage(caught, t('error.unknownSentence')));
    } finally {
      setRunning(null);
    }
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const result = validateHeroImage(fields, i18n);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) {
      document.getElementById(`${id}-${Object.keys(result.errors)[0]}`)?.focus();
      return;
    }
    void run('save', async () => {
      await onSave(result.input);
      // What was saved (trimmed) becomes the starting point of the next edit.
      setFields(toHeroImageFields(result.input));
      setDone(true);
    });
  };

  const renderField = ({ key, label, placeholder }: (typeof FIELDS)[number]) => {
    const fieldError = errors[key];
    return (
      <label className="field" key={key}>
        <span className="label">
          {t(label)}
          {key === 'alt' && <span aria-hidden="true"> *</span>}
        </span>
        <input
          id={`${id}-${key}`}
          value={fields[key]}
          onChange={(event) => {
            const value = event.target.value;
            setFields((current) => ({ ...current, [key]: value }));
            setErrors(({ [key]: _fixed, ...rest }) => rest);
            setDone(false);
          }}
          placeholder={t(placeholder)}
          maxLength={HERO_IMAGE_LIMITS[key]}
          required={key === 'alt'}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${id}-${key}-error` : undefined}
        />
        {fieldError && (
          <span id={`${id}-${key}-error`} className="field-error">
            {fieldError}
          </span>
        )}
      </label>
    );
  };

  return (
    <form className="image-field-controls" onSubmit={handleSubmit} aria-labelledby={labelledBy} noValidate>
      {head}
      <div className="settings-grid">{FIELDS.map(renderField)}</div>
      <p className="help">{t('hero.fallbackHelp')}</p>
      {warnings.map((warning) => (
        <p key={warning} className="field-warning">
          {t('hero.warning', { warning })}
        </p>
      ))}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {doneText !== undefined && (
        // The region exists from the start: so the screen reader announces the text when it appears.
        <p className="field-status" role="status">
          {done ? doneText : ''}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={running !== null || !changed || !canSave}>
          {running === 'save' ? t('common.saving') : saveLabel}
        </button>
        <button type="button" className={remove.tone} disabled={running !== null} onClick={() => void run('remove', remove.onClick)}>
          {running === 'remove' ? t('common.deleting') : remove.label}
        </button>
      </div>
    </form>
  );
}

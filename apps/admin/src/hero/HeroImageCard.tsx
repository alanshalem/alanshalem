import { useId, useState, type FormEvent, type ReactNode } from 'react';
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
  title: string;
  /** Estado corto junto al título (archivos sin guardar). */
  badge?: { text: string; tone?: 'error' } | undefined;
  /** Resumen corto del ítem (el recorte y el fundido de un video). */
  summary?: string | undefined;
  /** Miniatura o, para un video sin subir, el editor de recorte (la tarjeta pasa a una columna). */
  thumbnail: ReactNode;
  /** Valores guardados; sin ellos la tarjeta es una foto nueva. */
  saved?: HeroImageInput | undefined;
  /** false mientras el archivo sigue en la fila o subiendo (todavía no hay asset al que asociar el texto). */
  canSave?: boolean | undefined;
  /** Error que viene de afuera de la tarjeta (el chequeo de tamaño, la subida o el proceso del video). */
  error?: string | null | undefined;
  /** Avisos que no impiden guardar (tamaño menor que el ideal, los `warnings` de la API). */
  warnings?: readonly string[] | undefined;
  saveLabel: string;
  onSave: (input: HeroImageInput) => Promise<void>;
  remove: { label: string; tone: 'ghost' | 'danger'; onClick: () => Promise<void> | void };
}

// El ejemplo del campo en inglés está en inglés: muestran qué escribir ahí, en cualquier idioma de la interfaz.
const FIELDS: readonly { key: keyof HeroImageInput; label: MessageKey; placeholder: MessageKey }[] = [
  { key: 'alt', label: 'image.alt', placeholder: 'hero.altPlaceholder' },
  { key: 'credit', label: 'hero.credit', placeholder: 'hero.creditPlaceholder' },
  { key: 'altEn', label: 'hero.altEn', placeholder: 'hero.altEnPlaceholder' },
];

/**
 * Un ítem del hero (foto o video): miniatura, texto alternativo (en español y en inglés) y crédito. La misma tarjeta
 * sirve para un archivo recién subido (POST) y para un ítem guardado (PUT), así el formulario no se duplica. Cada
 * tarjeta es su propio <form>: Enter guarda ese ítem y nada más.
 */
export function HeroImageCard({
  title,
  badge,
  summary,
  thumbnail,
  saved,
  canSave = true,
  error,
  warnings = [],
  saveLabel,
  onSave,
  remove,
}: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const id = useId();
  const [fields, setFields] = useState<HeroImageFields>(() => toHeroImageFields(saved));
  const [errors, setErrors] = useState<HeroImageErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState<'save' | 'remove' | null>(null);

  const changed = saved === undefined || JSON.stringify(fields) !== JSON.stringify(toHeroImageFields(saved));
  const problem = error ?? failure;

  // Una acción a la vez por tarjeta; el mensaje de la API (ProblemDetails) queda en la tarjeta.
  const run = async (kind: 'save' | 'remove', action: () => Promise<void> | void): Promise<void> => {
    setRunning(kind);
    setFailure(null);
    try {
      await action();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : t('error.unknownSentence'));
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
      // Lo que quedó guardado (recortado) pasa a ser el punto de partida de la próxima edición.
      setFields(toHeroImageFields(result.input));
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
    <form className="hero-card" onSubmit={handleSubmit} aria-labelledby={`${id}-title`} noValidate>
      {thumbnail}
      <div className="image-field-controls">
        <div className="hero-card-head">
          <h3 id={`${id}-title`} className="label hero-card-title">
            {title}
          </h3>
          {badge && <span className={badge.tone === 'error' ? 'chip chip-error' : 'chip'}>{badge.text}</span>}
        </div>
        {summary && <p className="chip hero-card-summary">{summary}</p>}
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
        <div className="actions">
          <button type="submit" className="primary" disabled={running !== null || !changed || !canSave}>
            {running === 'save' ? t('common.saving') : saveLabel}
          </button>
          <button type="button" className={remove.tone} disabled={running !== null} onClick={() => void run('remove', remove.onClick)}>
            {running === 'remove' ? t('common.deleting') : remove.label}
          </button>
        </div>
      </div>
    </form>
  );
}

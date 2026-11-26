import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
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
  /** Lo que va arriba de los campos (título y estado de un archivo en curso, o el resumen del recorte de un video). */
  head?: ReactNode;
  /** El id del título que nombra al formulario, si lo hay. */
  labelledBy?: string | undefined;
  /** Valores guardados; sin ellos es un ítem nuevo. */
  saved?: HeroImageInput | undefined;
  /** false mientras el archivo sigue en la fila o subiendo (todavía no hay asset al que asociar el texto). */
  canSave?: boolean | undefined;
  /** Error que viene de afuera del formulario (el chequeo de tamaño, la subida o el proceso del video). */
  error?: string | null | undefined;
  /** Avisos que no impiden guardar (tamaño menor que el ideal, los `warnings` de la API). */
  warnings?: readonly string[] | undefined;
  saveLabel: string;
  onSave: (input: HeroImageInput) => Promise<void>;
  remove: { label: string; tone: 'ghost' | 'danger'; onClick: () => Promise<void> | void };
  /** Avisa si hay cambios sin guardar (el panel lateral pregunta antes de cerrar o pasar a otro ítem). */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Se anuncia al guardar y queda a la vista hasta el próximo cambio (en el panel: el aviso de la página queda inerte). */
  doneText?: string | undefined;
}

// Cada texto alternativo junto a su versión en inglés; el crédito es uno solo (multiidioma L13). El ejemplo del campo
// en inglés está en inglés: muestra qué escribir ahí, en cualquier idioma de la interfaz.
const FIELDS: readonly { key: keyof HeroImageInput; label: MessageKey; placeholder: MessageKey }[] = [
  { key: 'alt', label: 'image.alt', placeholder: 'hero.altPlaceholder' },
  { key: 'altEn', label: 'hero.altEn', placeholder: 'hero.altEnPlaceholder' },
  { key: 'credit', label: 'hero.credit', placeholder: 'hero.creditPlaceholder' },
];

/**
 * Los textos de un ítem del hero (texto alternativo en español e inglés y crédito) con Guardar y Eliminar/Descartar.
 * Lo usan la tarjeta de un archivo en curso (POST) y el panel lateral de un ítem guardado (PUT): el formulario no se
 * duplica. Es su propio <form>: Enter guarda ese ítem y nada más.
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

  // Una acción a la vez; el mensaje de la API (ProblemDetails) queda en el formulario.
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
        // La región existe desde el principio: así el lector de pantalla anuncia el texto cuando aparece.
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

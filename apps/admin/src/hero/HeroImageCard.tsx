import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { HeroImageInput } from '../api/types.ts';
import { HERO_IMAGE_LIMITS, validateHeroImage, type HeroImageErrors } from './heroImage.ts';

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

/**
 * Un ítem del hero (foto o video): miniatura, texto alternativo y crédito. La misma tarjeta sirve para un archivo
 * recién subido (POST) y para un ítem guardado (PUT), así el formulario no se duplica. Cada tarjeta es su propio
 * <form>: Enter guarda ese ítem y nada más.
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
  const id = useId();
  const [alt, setAlt] = useState(saved?.alt ?? '');
  const [credit, setCredit] = useState(saved?.credit ?? '');
  const [errors, setErrors] = useState<HeroImageErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState<'save' | 'remove' | null>(null);

  const changed = saved === undefined || alt !== saved.alt || credit !== (saved.credit ?? '');
  const problem = error ?? failure;

  // Una acción a la vez por tarjeta; el mensaje de la API (ProblemDetails) queda en la tarjeta.
  const run = async (kind: 'save' | 'remove', action: () => Promise<void> | void): Promise<void> => {
    setRunning(kind);
    setFailure(null);
    try {
      await action();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : 'Error desconocido.');
    } finally {
      setRunning(null);
    }
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const result = validateHeroImage(alt, credit);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) {
      document.getElementById(`${id}-${Object.keys(result.errors)[0]}`)?.focus();
      return;
    }
    void run('save', async () => {
      await onSave(result.input);
      // Lo que quedó guardado (recortado) pasa a ser el punto de partida de la próxima edición.
      setAlt(result.input.alt);
      setCredit(result.input.credit ?? '');
    });
  };

  const renderField = (key: keyof HeroImageInput, label: string, value: string, onChange: (value: string) => void, placeholder: string) => {
    const fieldError = errors[key];
    return (
      <label className="field">
        <span className="label">
          {label}
          {key === 'alt' && <span aria-hidden="true"> *</span>}
        </span>
        <input
          id={`${id}-${key}`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setErrors(({ [key]: _fixed, ...rest }) => rest);
          }}
          placeholder={placeholder}
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
        <div className="settings-grid">
          {renderField('alt', 'Texto alternativo', alt, setAlt, 'Qué se ve')}
          {renderField('credit', 'Crédito (opcional)', credit, setCredit, 'Foto: …')}
        </div>
        {warnings.map((warning) => (
          <p key={warning} className="field-warning">
            Aviso: {warning}
          </p>
        ))}
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={running !== null || !changed || !canSave}>
            {running === 'save' ? 'Guardando…' : saveLabel}
          </button>
          <button type="button" className={remove.tone} disabled={running !== null} onClick={() => void run('remove', remove.onClick)}>
            {running === 'remove' ? 'Eliminando…' : remove.label}
          </button>
        </div>
      </div>
    </form>
  );
}

import { renderMarkdown } from '@blog/markdown';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { ImageField } from '../components/ImageField.tsx';
import {
  emptySettingsForm,
  LIMITS,
  toSettingsForm,
  validateSettings,
  type SettingsErrors,
  type SettingsForm,
} from '../settings/validate.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

type TextKey = Exclude<keyof SettingsForm, 'bio' | 'heroImageUrl' | 'heroImageAlt' | 'heroImageCredit'>;

interface TextFieldSpec {
  key: TextKey;
  label: string;
  type?: 'email' | 'url' | 'text';
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  required?: boolean;
}

const IDENTITY: TextFieldSpec[] = [
  { key: 'name', label: 'Nombre', required: true, maxLength: LIMITS.name, hint: 'Aparece en el hero y en el footer.' },
  {
    key: 'tagline',
    label: 'Frase corta',
    maxLength: LIMITS.tagline,
    hint: 'Una línea: la descripción del sitio para buscadores y redes.',
  },
];

const LINKS: TextFieldSpec[] = [
  { key: 'email', label: 'Email', type: 'email', placeholder: 'vos@ejemplo.com' },
  { key: 'githubUrl', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…' },
  { key: 'linkedinUrl', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/…' },
  { key: 'xUrl', label: 'X', type: 'url', placeholder: 'https://x.com/…' },
];

/** Datos del autor (S4): nombre, bio, links y foto del hero. Guardar regenera el sitio. */
export function SettingsPage({ onError }: Props) {
  const [form, setForm] = useState<SettingsForm>(emptySettingsForm);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(emptySettingsForm()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const dirty = JSON.stringify(form) !== saved;

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        const loaded = toSettingsForm(settings);
        setForm(loaded);
        setSaved(JSON.stringify(loaded));
      })
      .catch((caught: unknown) => {
        if (!onError(caught)) {
          setMessage({ kind: 'error', text: `No se pudieron cargar los ajustes: ${caught instanceof Error ? caught.message : 'error desconocido'}` });
        }
      })
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (key: keyof SettingsForm, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  };

  const save = useCallback(async (): Promise<void> => {
    const result = validateSettings(form);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ kind: 'error', text: 'Revisá los campos marcados.' });
      // Llevar el foco al primer campo con error, para teclado y lectores de pantalla.
      const first = Object.keys(result.errors)[0];
      if (first) document.getElementById(`settings-${first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage(null);
    try {
      const stored = toSettingsForm(await api.saveSettings(result.input));
      setForm(stored);
      setSaved(JSON.stringify(stored));
      setMessage({
        kind: 'ok',
        text: 'Ajustes guardados. El sitio se está regenerando; en unos segundos los cambios estarán online.',
      });
    } catch (caught) {
      if (!onError(caught)) {
        // El mensaje de la API (ProblemDetails) es la autoridad: se muestra tal cual.
        setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : 'No se pudieron guardar los ajustes.' });
      }
    } finally {
      setBusy(false);
    }
  }, [form, onError]);

  // Ctrl/Cmd+S guarda, igual que en el editor de posts.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const deferredBio = useDeferredValue(form.bio);
  const bioHtml = useMemo(() => renderMarkdown(deferredBio, { headingOffset: 2 }).html, [deferredBio]);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void save();
  };

  if (loading) return <p className="center-note">Cargando…</p>;

  const renderField = (spec: TextFieldSpec) => {
    const id = `settings-${spec.key}`;
    const error = errors[spec.key];
    const describedBy = [error ? `${id}-error` : null, spec.hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
    return (
      <div className="field" key={spec.key}>
        <label className="label" htmlFor={id}>
          {spec.label}
          {spec.required && <span aria-hidden="true"> *</span>}
        </label>
        <input
          id={id}
          type={spec.type ?? 'text'}
          value={form[spec.key]}
          onChange={(event) => update(spec.key, event.target.value)}
          placeholder={spec.placeholder}
          maxLength={spec.maxLength}
          required={spec.required}
          spellCheck={spec.type === 'url' || spec.type === 'email' ? false : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {spec.hint && (
          <p id={`${id}-hint`} className="help">
            {spec.hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    // noValidate: la validación propia marca todos los campos a la vez y con los mismos mensajes que la API.
    <form className="settings" onSubmit={handleSubmit} noValidate>
      <div className="page-head page-head-sticky">
        <div>
          <p className="eyebrow">Sitio</p>
          <h1 className="page-title">Ajustes</h1>
        </div>
        <div className="actions">
          <span className="meta">{dirty ? 'Cambios sin guardar' : 'Todo guardado'}</span>
          <button type="submit" className="primary" disabled={busy || !dirty}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      {message && (
        <p
          className={message.kind === 'error' ? 'banner banner-error' : 'banner banner-ok'}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      <section className="settings-section" aria-labelledby="settings-identity">
        <div className="section-head">
          <h2 id="settings-identity">Autor</h2>
          <p className="section-note">Lo que se ve en el hero y el footer de todas las páginas.</p>
        </div>
        <div className="settings-grid">{IDENTITY.map(renderField)}</div>

        <div className="bio-editor">
          <div className="field">
            <label className="label" htmlFor="settings-bio">
              Bio (Markdown)
            </label>
            <textarea
              id="settings-bio"
              className="bio-input"
              value={form.bio}
              onChange={(event) => update('bio', event.target.value)}
              rows={9}
              maxLength={LIMITS.bio}
              lang="es"
              spellCheck
              aria-invalid={errors.bio ? true : undefined}
              aria-describedby={errors.bio ? 'settings-bio-error settings-bio-count' : 'settings-bio-count'}
              placeholder="Dos o tres líneas sobre vos. Admite **negrita**, *cursiva* y [links](https://…)."
            />
            <p id="settings-bio-count" className="help">
              {form.bio.length} / {LIMITS.bio}
            </p>
            {errors.bio && (
              <p id="settings-bio-error" className="field-error">
                {errors.bio}
              </p>
            )}
          </div>
          <div className="field">
            <span className="label" id="settings-bio-preview">
              Vista previa
            </span>
            <div className="paper bio-preview" aria-labelledby="settings-bio-preview">
              {form.bio.trim() === '' ? (
                <p className="bio-preview-empty">Sin bio todavía.</p>
              ) : (
                <div className="prose" dangerouslySetInnerHTML={{ __html: bioHtml }} />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-links">
        <div className="section-head">
          <h2 id="settings-links">Contacto y redes</h2>
          <p className="section-note">Vacío = no se muestra. Los enlaces tienen que empezar con https://.</p>
        </div>
        <div className="settings-grid">{LINKS.map(renderField)}</div>
      </section>

      <section className="settings-section" aria-labelledby="settings-hero">
        <div className="section-head">
          <h2 id="settings-hero">Foto del hero</h2>
          <p className="section-note">La imagen de fondo de la home.</p>
        </div>
        <ImageField
          legend="Imagen"
          url={form.heroImageUrl}
          alt={form.heroImageAlt}
          onUrlChange={(value) => update('heroImageUrl', value)}
          onAltChange={(value) => update('heroImageAlt', value)}
          onUpload={api.uploadImage}
          error={errors.heroImageUrl}
          altError={errors.heroImageAlt}
          help="Si no cargás ninguna, la home usa la foto por defecto del sitio si existe; si no, un hero tipográfico oscuro. Conviene una foto horizontal grande (2400 px o más de ancho)."
        >
          <label className="field">
            <span className="label">Crédito</span>
            <input
              value={form.heroImageCredit}
              onChange={(event) => update('heroImageCredit', event.target.value)}
              placeholder="Foto: …"
              maxLength={LIMITS.imageCredit}
              aria-invalid={errors.heroImageCredit ? true : undefined}
            />
          </label>
          {errors.heroImageCredit && <p className="field-error">{errors.heroImageCredit}</p>}
        </ImageField>
      </section>
    </form>
  );
}

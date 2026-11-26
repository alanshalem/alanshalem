import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { Banner, type Notice } from '../components/Banner.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { HeroGallery } from '../hero/HeroGallery.tsx';
import type { Translate } from '../i18n/i18n.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { pageTitle } from '../navigation/pageTitle.ts';
import { useUnsavedGuard } from '../navigation/useUnsavedGuard.ts';
import { BioField } from '../settings/BioField.tsx';
import { LIMITS } from '../limits.ts';
import {
  emptySettingsForm,
  toSettingsForm,
  validateSettings,
  type SettingsErrors,
  type SettingsForm,
} from '../settings/validate.ts';
import { useSaveShortcut } from '../useSaveShortcut.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

type TextKey = Exclude<keyof SettingsForm, 'bio' | 'bioEn'>;

const FORM_ID = 'settings-form';

interface TextFieldSpec {
  key: TextKey;
  label: string;
  type?: 'email' | 'url' | 'text';
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  required?: boolean;
  /** Ocupa toda la fila de la grilla (el nombre: no tiene par en inglés). */
  wide?: boolean;
}

// Los textos en inglés son opcionales (L3, L6): vacíos, el sitio en inglés muestra los de español (`fallbackHint`).
// El nombre es uno solo en los dos idiomas (L12).
const identityFields = (t: Translate): TextFieldSpec[] => [
  { key: 'name', label: t('settings.name'), required: true, maxLength: LIMITS.settings.name, hint: t('settings.nameHint'), wide: true },
  { key: 'tagline', label: t('settings.tagline'), maxLength: LIMITS.settings.tagline, hint: t('settings.taglineHint') },
  { key: 'taglineEn', label: t('settings.taglineEn'), maxLength: LIMITS.settings.tagline, hint: t('settings.fallbackHint') },
];

// GitHub, LinkedIn y X son marcas: no se traducen.
const linkFields = (t: Translate): TextFieldSpec[] => [
  { key: 'email', label: t('settings.email'), type: 'email', placeholder: t('settings.emailPlaceholder') },
  { key: 'githubUrl', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…' },
  { key: 'linkedinUrl', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/…' },
  { key: 'xUrl', label: 'X', type: 'url', placeholder: 'https://x.com/…' },
];

/**
 * Datos del autor (S4): nombre, bio y links; guardar regenera el sitio. Las fotos del hero van debajo, fuera del
 * <form>: cada una se guarda por separado y sus campos no deben disparar el "Guardar" de los ajustes.
 */
export function SettingsPage({ onError }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const [form, setForm] = useState<SettingsForm>(emptySettingsForm);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(emptySettingsForm()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [message, setMessage] = useState<Notice | null>(null);

  const dirty = JSON.stringify(form) !== saved;
  useUnsavedGuard(dirty);

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
          const error = caught instanceof Error ? caught.message : t('error.unknown');
          setMessage({ kind: 'error', text: t('settings.loadError', { error }) });
        }
      })
      .finally(() => setLoading(false));
    // Sin `t`: cambiar el idioma de la interfaz no vuelve a cargar los ajustes (pisaría lo que se está editando).
  }, [onError]);

  const update = (key: keyof SettingsForm, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  };

  const save = useCallback(async (): Promise<void> => {
    const result = validateSettings(form, i18n);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ kind: 'error', text: t('settings.checkFields') });
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
      setMessage({ kind: 'ok', text: t('settings.saved') });
    } catch (caught) {
      if (!onError(caught)) {
        // El mensaje de la API (ProblemDetails) es la autoridad: se muestra tal cual.
        setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : t('settings.saveError') });
      }
    } finally {
      setBusy(false);
    }
  }, [form, onError, i18n, t]);

  useSaveShortcut(save); // igual que en el editor de posts

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void save();
  };

  if (loading) return <p className="center-note">{t('common.loading')}</p>;

  const renderField = (spec: TextFieldSpec) => {
    const id = `settings-${spec.key}`;
    const error = errors[spec.key];
    const describedBy = [error ? `${id}-error` : null, spec.hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
    return (
      <div className={spec.wide ? 'field field-wide' : 'field'} key={spec.key}>
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
    <div className="settings">
      <PageHead
        sticky
        heading={t('nav.settings')}
        documentTitle={pageTitle({ name: 'settings' }, t)}
        above={<p className="eyebrow">{t('settings.eyebrow')}</p>}
      >
        <div className="actions">
          <span className="meta">{dirty ? t('common.unsaved') : t('common.allSaved')}</span>
          <button type="submit" form={FORM_ID} className="primary" disabled={busy || !dirty}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </PageHead>

      <Banner notice={message} />

      {/* noValidate: la validación propia marca todos los campos a la vez y con los mismos mensajes que la API. */}
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate>
        <section className="settings-section" aria-labelledby="settings-identity">
          <div className="section-head">
            <h2 id="settings-identity">{t('settings.author')}</h2>
            <p className="section-note">{t('settings.authorNote')}</p>
          </div>
          <div className="settings-grid">{identityFields(t).map(renderField)}</div>

          <BioField
            name="bio"
            label={t('settings.bio')}
            lang="es"
            value={form.bio}
            error={errors.bio}
            placeholder={t('settings.bioPlaceholder')}
            onChange={(value) => update('bio', value)}
          />
          <BioField
            name="bioEn"
            label={t('settings.bioEn')}
            lang="en"
            value={form.bioEn}
            error={errors.bioEn}
            hint={t('settings.fallbackHint')}
            placeholder={t('settings.bioEnPlaceholder')}
            onChange={(value) => update('bioEn', value)}
          />
        </section>

        <section className="settings-section" aria-labelledby="settings-links">
          <div className="section-head">
            <h2 id="settings-links">{t('settings.links')}</h2>
            <p className="section-note">{t('settings.linksNote')}</p>
          </div>
          <div className="settings-grid">{linkFields(t).map(renderField)}</div>
        </section>
      </form>

      <HeroGallery onError={onError} />
    </div>
  );
}

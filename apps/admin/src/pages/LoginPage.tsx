import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client.ts';
import { UiLanguageSwitch, useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { MessageKey } from '../i18n/i18n.ts';
import { SITE_URL } from '../siteUrl.ts';

interface Props {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const { t } = useUiLanguage();
  const [password, setPassword] = useState('');
  // La clave y no el texto: si se cambia de idioma con el error a la vista, el error también cambia.
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (caught) {
      // Mensaje genérico a propósito: no revelamos nada útil para adivinar la contraseña.
      setError(caught instanceof ApiError && caught.status === 429 ? 'login.tooManyAttempts' : 'login.wrongPassword');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login" onSubmit={(event) => void handleSubmit(event)} aria-labelledby="login-title">
        <p className="eyebrow">{t('login.eyebrow')}</p>
        <h1 id="login-title" className="login-title">
          Admin
        </h1>
        <p className="login-dek">{t('login.dek')}</p>

        <div className="field">
          <label className="label" htmlFor="login-password">
            {t('login.password')}
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>
        {error && (
          <p id="login-error" className="field-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="primary login-submit" disabled={busy || password === ''}>
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
        <div className="login-foot">
          <a className="login-back" href={SITE_URL}>
            {t('login.back')}
          </a>
          <UiLanguageSwitch />
        </div>
      </form>
    </main>
  );
}

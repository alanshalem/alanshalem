import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client.ts';
import { SITE_URL } from '../siteUrl.ts';

interface Props {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      setError(
        caught instanceof ApiError && caught.status === 429
          ? 'Demasiados intentos. Esperá unos minutos.'
          : 'Contraseña incorrecta.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login" onSubmit={(event) => void handleSubmit(event)} aria-labelledby="login-title">
        <p className="eyebrow">Panel de escritura</p>
        <h1 id="login-title" className="login-title">
          Admin
        </h1>
        <p className="login-dek">Entrá para escribir, editar y publicar.</p>

        <div className="field">
          <label className="label" htmlFor="login-password">
            Contraseña
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
            {error}
          </p>
        )}
        <button type="submit" className="primary login-submit" disabled={busy || password === ''}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <a className="login-back" href={SITE_URL}>
          ← Volver al sitio
        </a>
      </form>
    </main>
  );
}

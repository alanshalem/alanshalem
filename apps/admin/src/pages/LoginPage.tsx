import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client.ts';

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
    <form className="login" onSubmit={(event) => void handleSubmit(event)}>
      <h1>Admin</h1>
      <label>
        Contraseña
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy || password === ''}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

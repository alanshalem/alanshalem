import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api/client.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { PostEditorPage } from './pages/PostEditorPage.tsx';
import { PostsPage } from './pages/PostsPage.tsx';
import { useRoute } from './useRoute.ts';

type Session = 'loading' | 'anonymous' | 'authenticated';

export function App() {
  const [session, setSession] = useState<Session>('loading');
  const route = useRoute();

  useEffect(() => {
    api
      .me()
      .then(() => setSession('authenticated'))
      .catch(() => setSession('anonymous'));
  }, []);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession('anonymous');
  }, []);

  // Si la sesión vence en medio del trabajo, cualquier página puede avisar con esto.
  const handleSessionExpired = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) {
      setSession('anonymous');
      return true;
    }
    return false;
  }, []);

  if (session === 'loading') return <p className="center-note">Cargando…</p>;
  if (session === 'anonymous') return <LoginPage onLoggedIn={() => setSession('authenticated')} />;

  return (
    <div className="shell">
      <header className="shell-header">
        <a className="brand" href="#/">
          Admin
        </a>
        <button type="button" className="link-button" onClick={() => void handleLogout()}>
          Salir
        </button>
      </header>
      <main className="shell-main">
        {route.name === 'posts' && <PostsPage onError={handleSessionExpired} />}
        {route.name === 'new' && <PostEditorPage key="new" postId={null} onError={handleSessionExpired} />}
        {route.name === 'edit' && <PostEditorPage key={route.id} postId={route.id} onError={handleSessionExpired} />}
      </main>
    </div>
  );
}

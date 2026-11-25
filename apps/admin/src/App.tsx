import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api/client.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { PostEditorPage } from './pages/PostEditorPage.tsx';
import { PostsPage } from './pages/PostsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { href, useRoute } from './useRoute.ts';

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

  const section = route.name === 'settings' ? 'settings' : 'posts';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <header className="shell-header">
        <a className="brand" href={href.posts}>
          Admin
        </a>
        <nav className="shell-nav" aria-label="Secciones">
          <a href={href.posts} aria-current={section === 'posts' ? 'page' : undefined}>
            Posts
          </a>
          <a href={href.settings} aria-current={section === 'settings' ? 'page' : undefined}>
            Ajustes
          </a>
          <a href="/" target="_blank" rel="noopener">
            Ver sitio ↗
          </a>
        </nav>
        <button type="button" className="ghost logout" onClick={() => void handleLogout()}>
          Salir
        </button>
      </header>
      <main id="main" className="shell-main" tabIndex={-1}>
        {route.name === 'posts' && <PostsPage onError={handleSessionExpired} />}
        {route.name === 'new' && <PostEditorPage key="new" postId={null} onError={handleSessionExpired} />}
        {route.name === 'edit' && <PostEditorPage key={route.id} postId={route.id} onError={handleSessionExpired} />}
        {route.name === 'settings' && <SettingsPage onError={handleSessionExpired} />}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api/client.ts';
import { UiLanguageSwitch, useUiLanguage } from './i18n/UiLanguage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { PostEditorPage } from './pages/PostEditorPage.tsx';
import { PostsPage } from './pages/PostsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SITE_URL } from './siteUrl.ts';
import { confirmNavigation, href, markViewChange, useRoute } from './useRoute.ts';

type Session = 'loading' | 'anonymous' | 'authenticated';

export function App() {
  const [session, setSession] = useState<Session>('loading');
  const route = useRoute();
  const { t } = useUiLanguage();

  useEffect(() => {
    api
      .me()
      .then(() => setSession('authenticated'))
      .catch(() => setSession('anonymous'));
  }, []);

  const handleLogout = useCallback(async () => {
    if (!confirmNavigation(null)) return; // cambios sin guardar: se pregunta antes de cerrar la sesión
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

  if (session === 'loading') return <p className="center-note">{t('common.loading')}</p>;
  if (session === 'anonymous') {
    const onLoggedIn = (): void => {
      markViewChange(); // el formulario desaparece: el foco va al título de la vista que se abre
      setSession('authenticated');
    };
    return <LoginPage onLoggedIn={onLoggedIn} />;
  }

  const section = route.name === 'settings' ? 'settings' : 'posts';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <header className="shell-header">
        <a className="brand" href={href.posts}>
          Admin
        </a>
        <nav className="shell-nav" aria-label={t('nav.sections')}>
          <a href={href.posts} aria-current={section === 'posts' ? 'page' : undefined}>
            {t('nav.posts')}
          </a>
          <a href={href.settings} aria-current={section === 'settings' ? 'page' : undefined}>
            {t('nav.settings')}
          </a>
          {/* Se abre en otra pestaña: la flecha lo muestra y el texto oculto lo dice (el nombre empieza igual). */}
          <a href={SITE_URL} target="_blank" rel="noopener">
            {t('nav.viewSite')} <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> {t('nav.newTab')}</span>
          </a>
        </nav>
        <UiLanguageSwitch />
        <button type="button" className="ghost" onClick={() => void handleLogout()}>
          {t('nav.logout')}
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

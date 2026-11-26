import type { Translate } from '../i18n/i18n.ts';

/** Las vistas del admin, con lo que su título necesita (el del post que se edita). */
export type PageView =
  | { name: 'posts' }
  | { name: 'new' }
  | { name: 'edit'; title: string }
  | { name: 'settings' }
  | { name: 'login' };

function pageName(view: PageView, t: Translate): string {
  switch (view.name) {
    case 'posts':
      return t('nav.posts');
    case 'new':
      return t('post.new');
    case 'edit':
      return t('title.edit', { title: view.title.trim() || t('common.untitled') });
    case 'settings':
      return t('nav.settings');
    case 'login':
      return t('login.submit');
  }
}

/**
 * El `document.title` de cada vista (WCAG 2.4.2): la pestaña, el historial y el lector de pantalla dicen dónde se
 * está ("Editar: Hola · Admin"), no "Admin" en todas.
 */
export const pageTitle = (view: PageView, t: Translate): string => t('title.page', { page: pageName(view, t) });

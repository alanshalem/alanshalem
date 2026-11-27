import type { Translate } from '../i18n/i18n.ts';

/** The admin views, with what their title needs (the title of the post being edited). */
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
 * Each view's `document.title` (WCAG 2.4.2): the tab, the history and the screen reader say where you are
 * ("Editar: Hola · Admin"), not "Admin" everywhere.
 */
export const pageTitle = (view: PageView, t: Translate): string => t('title.page', { page: pageName(view, t) });

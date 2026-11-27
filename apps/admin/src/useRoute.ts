import { useEffect, useState } from 'react';
import { confirmLeave } from './navigation/leaveGuard.ts';

/**
 * Minimal hash-based router (#/posts/abc). With 4 screens no library is needed, and the hash avoids configuring
 * rewrites on the static server.
 */
export type Route =
  | { name: 'posts' }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'settings' };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'posts/new') return { name: 'new' };
  if (path === 'ajustes') return { name: 'settings' };
  const edit = /^posts\/([\w-]+)$/.exec(path);
  if (edit?.[1]) return { name: 'edit', id: edit[1] };
  return { name: 'posts' };
}

const currentRoute = (): Route => parse(window.location.hash);

// The target already confirmed (link or `navigate`): the following hashchange does not ask again.
let approved: string | null = null;
// Whether a view change already happened: the first view after loading does not move focus (usePageHeading).
let viewChanged = false;

/** Whether the view changed since the admin loaded (link, back, log in). */
export const hasViewChanged = (): boolean => viewChanged;
export const markViewChange = (): void => void (viewChanged = true);

/**
 * Asks before leaving the view with unsaved changes (useUnsavedGuard); true = go on. `target` null = something without
 * a route yet (logging out, the version about to be created).
 */
export function confirmNavigation(target: string | null): boolean {
  return confirmLeave(currentRoute(), target === null ? null : parse(target));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    // Links are decided before the hash changes: if cancelled, no history entry is left to undo.
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      const target = link?.getAttribute('href');
      if (!target) return;
      if (confirmNavigation(target)) approved = target;
      else event.preventDefault();
    };
    // Back/forward or a hand-typed URL: the hash already changed; if cancelled, go back to the previous view.
    const onHashChange = (event: HashChangeEvent): void => {
      const next = window.location.hash;
      const wasApproved = approved !== null && JSON.stringify(parse(approved)) === JSON.stringify(parse(next));
      approved = null;
      if (!wasApproved && !confirmLeave(parse(new URL(event.oldURL).hash), parse(next))) {
        window.history.pushState(null, '', new URL(event.oldURL).hash || '#/');
        return;
      }
      viewChanged = true;
      setRoute(parse(next));
    };
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  return route;
}

export const href = {
  posts: '#/',
  newPost: '#/posts/new',
  post: (id: string): string => `#/posts/${id}`,
  settings: '#/ajustes',
};

/**
 * Changes the view, asking first if there are unsaved changes. `confirmed`: already asked (or nothing to lose, as after
 * deleting the post), so it does not ask again.
 */
export function navigate(target: string, { confirmed = false }: { confirmed?: boolean } = {}): void {
  if (!confirmed && !confirmNavigation(target)) return;
  approved = target;
  window.location.hash = target;
}

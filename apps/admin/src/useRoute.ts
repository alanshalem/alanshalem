import { useEffect, useState } from 'react';
import { confirmLeave } from './navigation/leaveGuard.ts';

/**
 * Router mínimo basado en el hash (#/posts/abc). Con 4 pantallas no hace falta una librería,
 * y el hash evita configurar rewrites en el servidor estático.
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

// El destino que ya se confirmó (enlace o `navigate`): el hashchange que sigue no vuelve a preguntar.
let approved: string | null = null;
// Si ya hubo un cambio de vista: la primera vista después de cargar no mueve el foco (usePageHeading).
let viewChanged = false;

/** Si hubo un cambio de vista desde que se cargó el admin (enlace, atrás, entrar). */
export const hasViewChanged = (): boolean => viewChanged;
export const markViewChange = (): void => void (viewChanged = true);

/**
 * Pregunta antes de dejar la vista con cambios sin guardar (useUnsavedGuard); true = seguir. `target` null = algo
 * sin ruta todavía (cerrar sesión, la versión que se va a crear).
 */
export function confirmNavigation(target: string | null): boolean {
  return confirmLeave(currentRoute(), target === null ? null : parse(target));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    // Los enlaces se deciden antes de que cambie el hash: si se cancela, no queda una entrada de historial que deshacer.
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      const target = link?.getAttribute('href');
      if (!target) return;
      if (confirmNavigation(target)) approved = target;
      else event.preventDefault();
    };
    // Atrás/adelante o la URL a mano: el hash ya cambió; si se cancela, se vuelve a la vista de antes.
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
 * Cambia de vista preguntando antes si hay cambios sin guardar. `confirmed`: ya se preguntó (o no hay nada que perder,
 * como después de eliminar el post) y no se vuelve a preguntar.
 */
export function navigate(target: string, { confirmed = false }: { confirmed?: boolean } = {}): void {
  if (!confirmed && !confirmNavigation(target)) return;
  approved = target;
  window.location.hash = target;
}

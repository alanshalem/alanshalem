import { useEffect, useState } from 'react';

/**
 * Router mínimo basado en el hash (#/posts/abc). Con solo 3 pantallas no hace falta una librería,
 * y el hash evita configurar rewrites en el servidor estático.
 */
export type Route =
  | { name: 'posts' }
  | { name: 'new' }
  | { name: 'edit'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'posts/new') return { name: 'new' };
  const edit = /^posts\/([\w-]+)$/.exec(path);
  if (edit?.[1]) return { name: 'edit', id: edit[1] };
  return { name: 'posts' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const href = {
  posts: '#/',
  newPost: '#/posts/new',
  post: (id: string): string => `#/posts/${id}`,
};

export function navigate(target: string): void {
  window.location.hash = target;
}

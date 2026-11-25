/**
 * GET autenticado contra la API interna (token del builder).
 * Si la API falla, el build debe fallar: el builder conserva la versión anterior del sitio en vez de publicar una vacía.
 */
export async function getInternal<T>(path: string, what: string): Promise<T> {
  const apiUrl = process.env.API_URL;
  const token = process.env.BUILDER_TOKEN;
  if (!apiUrl || !token) {
    throw new Error(`Faltan las variables API_URL y BUILDER_TOKEN para leer ${what} durante el build.`);
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`La API respondió ${response.status} al pedir ${what}.`);
  }
  return (await response.json()) as T;
}

/** Servidor de desarrollo de Astro (`astro dev`). En los tests y en el build de producción es falso. */
const isDevServer = (): boolean => import.meta.env?.DEV === true;

/**
 * Envuelve un loader para que haga una sola petición por build: Astro renderiza todas las páginas en el mismo
 * proceso. En `astro dev` el proceso vive mientras editás en el admin, así que ahí se pide en cada render;
 * si no, los cambios (y hasta un fallo de la API) quedarían congelados hasta reiniciar el servidor.
 */
export function oncePerBuild<T>(load: () => Promise<T>, reloadEachCall: () => boolean = isDevServer): () => Promise<T> {
  let cache: Promise<T> | undefined;
  return () => (reloadEachCall() ? load() : (cache ??= load()));
}

/**
 * Authenticated GET against the internal API (the builder token).
 * If the API fails, the build must fail: the builder keeps the previous version of the site instead of publishing an
 * empty one.
 */
export async function getInternal<T>(path: string, what: string): Promise<T> {
  const apiUrl = process.env.API_URL;
  const token = process.env.BUILDER_TOKEN;
  if (!apiUrl || !token) {
    throw new Error(`API_URL and BUILDER_TOKEN are required to read ${what} during the build.`);
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`The API answered ${response.status} when asked for ${what}.`);
  }
  return (await response.json()) as T;
}

/** Astro's development server (`astro dev`). False in the tests and in the production build. */
const isDevServer = (): boolean => import.meta.env?.DEV === true;

/**
 * Wraps a loader so it makes a single request per build: Astro renders every page in the same process. In
 * `astro dev` the process lives on while you edit in the admin, so there it fetches on every render; otherwise the
 * changes (and even an API failure) would stay frozen until the server restarts.
 */
export function oncePerBuild<T>(load: () => Promise<T>, reloadEachCall: () => boolean = isDevServer): () => Promise<T> {
  let cache: Promise<T> | undefined;
  return () => (reloadEachCall() ? load() : (cache ??= load()));
}

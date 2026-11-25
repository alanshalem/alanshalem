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

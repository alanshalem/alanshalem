/** Esquemas permitidos en links e imágenes. Todo lo demás (javascript:, data:, vbscript:...) se rechaza. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Devuelve la URL lista para ir en un atributo (todavía sin escapar HTML),
 * o `null` si es insegura. Las URLs relativas (`/img/a.png`, `#ancla`, `../x`) son válidas.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return null;

  // Caracteres de control: se usan para ofuscar esquemas ("java\u0000script:").
  if (/[\u0000-\u001f\u007f-\u009f]/.test(url)) return null;

  // Los navegadores ignoran espacios dentro del esquema, así que lo evaluamos sin ellos.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/\s+/g, ''));
  if (scheme && !SAFE_SCHEMES.has((scheme[1] ?? '').toLowerCase())) return null;

  return url.replace(/\s/g, '%20');
}

/** ¿Apunta a otro sitio? Se usa para agregar rel="noopener noreferrer". */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

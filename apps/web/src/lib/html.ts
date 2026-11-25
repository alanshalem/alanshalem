/** Utilidades puras para leer y escribir el HTML que produce @blog/markdown. */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Deshace exactamente las entidades que emite `escapeHtml` de @blog/markdown. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** Valor (ya sin escapar) de un atributo entre comillas dobles de una etiqueta, o null si no está. */
export function readAttribute(tag: string, name: string): string | null {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? null : decodeEntities(value);
}

// Dentro de <script> el HTML manda: `</script>` o `<!--` cortarían el bloque. U+2028/2029 rompen JS viejo.
const SCRIPT_UNSAFE: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** JSON para incrustar en un <script>: mismo valor al parsearlo, sin ningún carácter que el HTML interprete. */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => SCRIPT_UNSAFE[char] ?? char);

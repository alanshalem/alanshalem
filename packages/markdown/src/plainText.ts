import { unescapeHtml } from './escape.ts';

/**
 * Texto plano de un HTML de este renderer (lo que se lee, espacios normalizados). Como el renderer escapa todo `<`
 * del contenido, sacar los tags con una regex es seguro acá; no sirve para HTML de otro origen.
 */
export function plainTextOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

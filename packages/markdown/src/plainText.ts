const ENTITIES: Array<[RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'], // siempre último, para no des-escapar dos veces
];

/**
 * Texto plano de un HTML de este renderer (lo que se lee, espacios normalizados). Como el renderer escapa todo `<`
 * del contenido, sacar los tags con una regex es seguro acá; no sirve para HTML de otro origen.
 */
export function plainTextOf(html: string): string {
  let text = html.replace(/<[^>]+>/g, ' ');
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

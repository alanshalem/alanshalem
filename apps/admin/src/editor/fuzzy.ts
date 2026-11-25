/* Búsqueda difusa de la paleta de comandos: subsecuencia, sin acentos ni mayúsculas ("titulo" encuentra "Título"). */

// Puntajes relativos: lo único que importa es el orden que producen.
const CONSECUTIVE_BONUS = 3;
const WORD_START_BONUS = 2;
const MATCH_POINT = 1;

const normalize = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Cuánto se parece `text` a `query` (más es mejor) o `null` si las letras no aparecen en orden. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = normalize(query).replace(/\s+/g, '');
  const haystack = normalize(text);
  let score = 0;
  let position = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, position + 1);
    if (found === -1) return null;
    score += MATCH_POINT;
    if (found === position + 1) score += CONSECUTIVE_BONUS;
    if (found === 0 || /[\s:/(-]/.test(haystack[found - 1] ?? '')) score += WORD_START_BONUS;
    position = found;
  }
  return score;
}

/** Los que coinciden, del más parecido al menos; los empates mantienen el orden original (el del registro). */
export function fuzzyFilter<T>(items: readonly T[], query: string, textOf: (item: T) => string): T[] {
  if (query.trim() === '') return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, textOf(item)) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

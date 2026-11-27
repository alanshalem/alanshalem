/* Fuzzy search of the command palette: subsequence, ignoring accents and case ("titulo" finds "Título"). */

// Relative scores: only the order they produce matters.
const CONSECUTIVE_BONUS = 3;
const WORD_START_BONUS = 2;
const MATCH_POINT = 1;

const normalize = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** How much `text` resembles `query` (more is better) or `null` if the letters do not appear in order. */
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

/** The matching ones, most similar first; ties keep the original order (the registry's). */
export function fuzzyFilter<T>(items: readonly T[], query: string, textOf: (item: T) => string): T[] {
  if (query.trim() === '') return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, textOf(item)) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

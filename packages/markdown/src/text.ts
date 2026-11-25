import { renderMarkdown } from './render.ts';

const ENTITIES: Array<[RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'], // siempre último, para no des-escapar dos veces
];

/**
 * Texto plano del documento. Como el renderer escapa todo `<` del contenido,
 * sacar los tags con una regex es seguro acá.
 */
export function toPlainText(markdown: string): string {
  let text = renderMarkdown(markdown).html.replace(/<[^>]+>/g, ' ');
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

/** Extracto para listados y meta description: corta en el límite de una palabra. */
export function excerpt(markdown: string, maxLength = 160): string {
  const text = toPlainText(markdown);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** Minutos de lectura (mínimo 1) a ~200 palabras por minuto. */
export function readingTimeMinutes(markdown: string, wordsPerMinute = 200): number {
  const words = toPlainText(markdown).split(' ').filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

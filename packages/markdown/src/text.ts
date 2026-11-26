import { renderMarkdown } from './render.ts';

/** Texto plano del documento (sin opciones de render): `renderMarkdown(markdown).text`. */
export function toPlainText(markdown: string): string {
  return renderMarkdown(markdown).text;
}

/** Extracto para listados y meta description: corta en el límite de una palabra. */
export function excerpt(markdown: string, maxLength = 160): string {
  const text = toPlainText(markdown);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** Palabras de un texto plano (el de `toPlainText` o `RenderResult.text`). */
export function wordCount(plainText: string): number {
  return plainText.split(/\s+/).filter(Boolean).length;
}

/**
 * Minutos de lectura (mínimo 1) a ~200 palabras por minuto de un texto plano ya calculado: quien ya renderizó
 * (la vista previa del admin) usa la fórmula del sitio sin volver a parsear.
 */
export function readingTimeOfText(plainText: string, wordsPerMinute = 200): number {
  return Math.max(1, Math.ceil(wordCount(plainText) / wordsPerMinute));
}

/** Minutos de lectura (mínimo 1) a ~200 palabras por minuto. */
export function readingTimeMinutes(markdown: string, wordsPerMinute = 200): number {
  return readingTimeOfText(toPlainText(markdown), wordsPerMinute);
}

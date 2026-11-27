import { renderMarkdown } from './render.ts';

/** Plain text of the document (without render options): `renderMarkdown(markdown).text`. */
export function toPlainText(markdown: string): string {
  return renderMarkdown(markdown).text;
}

/** Excerpt for listings and the meta description: cuts at a word boundary. */
export function excerpt(markdown: string, maxLength = 160): string {
  const text = toPlainText(markdown);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** Words of a plain text (the one from `toPlainText` or `RenderResult.text`). */
export function wordCount(plainText: string): number {
  return plainText.split(/\s+/).filter(Boolean).length;
}

/**
 * Reading minutes (at least 1) at ~200 words per minute of a plain text already computed: a caller that already
 * rendered (the admin preview) applies the site's formula without parsing again.
 */
export function readingTimeOfText(plainText: string, wordsPerMinute = 200): number {
  return Math.max(1, Math.ceil(wordCount(plainText) / wordsPerMinute));
}

/** Reading minutes (at least 1) at ~200 words per minute. */
export function readingTimeMinutes(markdown: string, wordsPerMinute = 200): number {
  return readingTimeOfText(toPlainText(markdown), wordsPerMinute);
}

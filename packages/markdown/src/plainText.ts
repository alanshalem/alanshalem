import { unescapeHtml } from './escape.ts';

/**
 * Plain text of HTML from this renderer (what is read, whitespace normalized). Since the renderer escapes every `<`
 * of the content, stripping tags with a regex is safe here; it does not work for HTML from any other source.
 */
export function plainTextOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

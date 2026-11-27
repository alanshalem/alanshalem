const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text for use as content or as an attribute value.
 * ALL user text goes through here: it is the barrier against XSS.
 * By design there is no raw HTML in the Markdown: `<script>` is shown as text.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// The inverse table, derived so the two can never disagree.
const HTML_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ESCAPES).map(([char, entity]) => [entity, char]),
);
const ESCAPED_ENTITY = new RegExp(Object.keys(HTML_UNESCAPES).join('|'), 'g');

/**
 * Inverse of `escapeHtml`: decodes exactly the five entities it emits, in one pass, so `&amp;lt;` becomes `&lt;` and
 * never `<`. Any other entity is left as is. Only for HTML built by `escapeHtml` (this renderer's output).
 */
export function unescapeHtml(html: string): string {
  return html.replace(ESCAPED_ENTITY, (entity) => HTML_UNESCAPES[entity] ?? entity);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa texto para usarlo como contenido o como valor de atributo.
 * TODO el texto del usuario pasa por acá: es la barrera contra XSS.
 * Por diseño no existe HTML crudo en el Markdown: `<script>` se muestra como texto.
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

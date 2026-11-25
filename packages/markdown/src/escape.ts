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

/** Texto seguro dentro de un nodo o atributo XML: los datos vienen de la API de GitHub y del feed. */
export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[ch]};`);

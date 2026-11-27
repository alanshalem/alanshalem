/** Text safe inside an XML node or attribute: the data comes from the GitHub API and the feed. */
export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[ch]};`);

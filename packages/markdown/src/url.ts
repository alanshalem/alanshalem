/** Schemes allowed in links and images. Everything else (javascript:, data:, vbscript:...) is rejected. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Returns the URL ready for an attribute (not HTML-escaped yet), or `null` when it is unsafe. Relative URLs
 * (`/img/a.png`, `#anchor`, `../x`) are valid.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return null;

  // Control characters: used to obfuscate schemes ("java\u0000script:").
  if (/[\u0000-\u001f\u007f-\u009f]/.test(url)) return null;

  // Browsers ignore whitespace inside the scheme, so it is checked without it.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/\s+/g, ''));
  if (scheme && !SAFE_SCHEMES.has((scheme[1] ?? '').toLowerCase())) return null;

  return url.replace(/\s/g, '%20');
}

/** Does it point to another site? Used to add rel="noopener noreferrer". */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

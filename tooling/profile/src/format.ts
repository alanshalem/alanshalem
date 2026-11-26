/** Formatos en inglés (el README del perfil es en inglés), siempre en UTC para que el render sea determinista. */

export const count = (value: number): string => value.toLocaleString('en-US');

export const plural = (value: number, word: string): string => `${count(value)} ${word}${value === 1 ? '' : 's'}`;

export const percent = (share: number): string => `${+(share * 100).toFixed(1)}%`;

const date = (iso: string, options: Intl.DateTimeFormatOptions): string =>
  new Date(iso).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

/** "Nov 25, 2026" */
export const fullDate = (iso: string): string => date(iso, { month: 'short', day: 'numeric', year: 'numeric' });

/** "Mar" */
export const month = (iso: string): string => date(iso, { month: 'short' });

/** "Mar 2019" */
export const monthYear = (iso: string): string => date(iso, { month: 'short', year: 'numeric' });

/** "Nov 20 – Nov 26, 2026"; con años distintos, los dos completos; un solo día, la fecha. */
export function dayRange(start: string, end: string): string {
  if (start === end) return fullDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? date(start, { month: 'short', day: 'numeric' }) : fullDate(start)} – ${fullDate(end)}`;
}

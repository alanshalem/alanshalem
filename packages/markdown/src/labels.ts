import type { Lang } from './types.ts';

/** Callout kinds (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`), in the order of GitHub's syntax. */
export const CALLOUT_KINDS = ['note', 'tip', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Visible or accessible texts the renderer adds (they do not come from the Markdown). */
export interface Labels extends Record<CalloutKind, string> {
  footnotes: string;
  backToText: string;
  /** Accessible name of the scrollable region that wraps each table. */
  table: string;
}

const DEFAULT_LANG: Lang = 'es';

// One single table: adding a language or a callout kind is adding a row or a key here.
const LABELS: Record<Lang, Labels> = {
  es: { note: 'Nota', tip: 'Puntos clave', warning: 'Advertencia', footnotes: 'Notas al pie', backToText: 'Volver al texto', table: 'Tabla' },
  en: { note: 'Note', tip: 'Key takeaways', warning: 'Warning', footnotes: 'Footnotes', backToText: 'Back to text', table: 'Table' },
};

/** The texts of the requested language; an unknown language (e.g. from untyped JS) falls back to Spanish. */
export function labelsFor(lang: Lang | undefined): Labels {
  return LABELS[lang ?? DEFAULT_LANG] ?? LABELS[DEFAULT_LANG];
}

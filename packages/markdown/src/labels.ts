import type { Lang } from './types.ts';

/** Tipos de caja destacada (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`), en el orden de la sintaxis de GitHub. */
export const CALLOUT_KINDS = ['note', 'tip', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Textos visibles o accesibles que agrega el renderer (no vienen del Markdown). */
export interface Labels extends Record<CalloutKind, string> {
  footnotes: string;
  backToText: string;
  /** Nombre accesible de la región con scroll que envuelve cada tabla. */
  table: string;
}

const DEFAULT_LANG: Lang = 'es';

// Una sola tabla: agregar un idioma o un tipo de caja es agregar una fila o una clave acá.
const LABELS: Record<Lang, Labels> = {
  es: { note: 'Nota', tip: 'Puntos clave', warning: 'Advertencia', footnotes: 'Notas al pie', backToText: 'Volver al texto', table: 'Tabla' },
  en: { note: 'Note', tip: 'Key takeaways', warning: 'Warning', footnotes: 'Footnotes', backToText: 'Back to text', table: 'Table' },
};

/** Los textos del idioma pedido; un idioma desconocido (p. ej. desde JS sin tipos) cae al español. */
export function labelsFor(lang: Lang | undefined): Labels {
  return LABELS[lang ?? DEFAULT_LANG] ?? LABELS[DEFAULT_LANG];
}

/*
 * Lo que el admin necesita leer del Markdown fuente (el revisor, el esquema): dónde hay código, títulos, notas y cajas.
 * Las expresiones copian las de packages/markdown (blocks.ts, footnotes.ts, labels.ts), que no las exporta; los tests
 * de las cajas y del esquema comparan con el renderer para que no se desfasen.
 */

/** Tipos de caja destacada que reconoce el renderer (`> [!NOTE]`…), en su orden. */
export const CALLOUT_KINDS = ['note', 'tip', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const calloutMarker = (kind: string): string => `[!${kind.toUpperCase()}]`;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** Un título en cualquier contenedor (cita, ítem de lista): `#` a `######` y un espacio o el final de la línea. */
const HEADING = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(#{1,6})(?:[ \t]|$)/;
export const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:/;
export const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;
// Los `code spans` se tapan con espacios: sin falsos avisos y con las columnas intactas.
const CODE_SPAN = /(`+)[^`\n]*?\1/g;

/** Una línea fuera de los bloques de código, con el código en línea tapado. `index` empieza en 0. */
export interface ProseLine {
  readonly index: number;
  readonly text: string;
}

/** Las líneas que no son código: lo que el renderer trata como texto. */
export function proseLines(markdown: string): ProseLine[] {
  const lines: ProseLine[] = [];
  let fence: string | null = null;
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (fence !== null) {
        // Cierra una tira del mismo carácter y al menos igual de larga, sola en su línea.
        const close = line.trim();
        if (close[0] === fence[0] && close.length >= fence.length && /^(`+|~+)$/.test(close)) fence = null;
        return;
      }
      const open = FENCE_OPEN.exec(line);
      if (open) fence = open[1] ?? '```';
      else lines.push({ index, text: line.replace(CODE_SPAN, (span) => ' '.repeat(span.length)) });
    });
  return lines;
}

/** Un título fuera de todo contenedor: el único que recibe ancla y entra al índice del renderer. */
export const isTopLevelHeading = (text: string): boolean => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text);

/** Nivel en el fuente (cantidad de `#`) de una línea de título, o null. */
export function headingLevel(text: string): number | null {
  return HEADING.exec(text)?.[1]?.length ?? null;
}

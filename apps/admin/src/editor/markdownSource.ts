/*
 * What the admin needs to read from the Markdown source (the reviewer, the outline): where code, headings, footnotes
 * and callouts are. The expressions copy those of packages/markdown (blocks.ts, footnotes.ts, labels.ts), which does
 * not export them; the callout and outline tests compare with the renderer so they do not drift.
 */

/** Callout kinds the renderer recognizes (`> [!NOTE]`…), in its order. */
export const CALLOUT_KINDS = ['note', 'tip', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const calloutMarker = (kind: string): string => `[!${kind.toUpperCase()}]`;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** A heading in any container (quote, list item): `#` to `######` and a space or the end of the line. */
const HEADING = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(#{1,6})(?:[ \t]|$)/;
export const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:/;
export const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;
// `Code spans` are masked with spaces: no false warnings and the columns stay intact.
const CODE_SPAN = /(`+)[^`\n]*?\1/g;

/** A line outside code blocks, with inline code masked. `index` starts at 0. */
export interface ProseLine {
  readonly index: number;
  readonly text: string;
}

/** The lines that are not code: what the renderer treats as text. */
export function proseLines(markdown: string): ProseLine[] {
  const lines: ProseLine[] = [];
  let fence: string | null = null;
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (fence !== null) {
        // Closed by a run of the same character, at least as long, alone on its line.
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

/** A heading outside any container: the only kind that gets an anchor and enters the renderer's index. */
export const isTopLevelHeading = (text: string): boolean => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text);

/** Source level (number of `#`) of a heading line, or null. */
export function headingLevel(text: string): number | null {
  return HEADING.exec(text)?.[1]?.length ?? null;
}

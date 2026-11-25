/*
 * Scroll sincronizado de la vista dividida (S2). El renderer (packages/markdown) no marca de qué línea sale cada
 * elemento, así que se mapea por índice de bloque: el Markdown se parte en bloques de nivel superior con las mismas
 * reglas que el renderer (cada uno es un hijo de .prose) y la vista previa interpola entre los pares de bloques.
 * Si las cuentas no coinciden (la vista previa todavía no se actualizó) cae a proporcional: nunca salta a cualquier lado.
 */

// Mismas expresiones que packages/markdown/src/blocks.ts y footnotes.ts (lo que define dónde empieza un bloque).
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]\s]+\]:/;
const CONTINUATION = /^[ \t]+\S/;

const isBlank = (line: string): boolean => line.trim() === '';
const indentOf = (line: string): number => /^[ \t]*/.exec(line)?.[0].replace(/\t/g, '    ').length ?? 0;
const listKind = (marker: string): string => (/\d/.test(marker) ? marker.slice(-1) : marker);

/** ¿Corta un párrafo? Una lista numerada solo si empieza en 1 ("2024. fue un gran año" no es lista). */
function interruptsParagraph(line: string): boolean {
  if (FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || BLOCKQUOTE.test(line)) return true;
  const item = LIST_ITEM.exec(line);
  if (!item || line.slice(item[0].length).trim() === '') return false;
  const marker = item[2] ?? '';
  return !/\d/.test(marker) || parseInt(marker, 10) === 1;
}

/** Las definiciones de notas al pie se sacan antes de partir en bloques (y dejan una línea en blanco). */
function withoutFootnoteDefinitions(lines: string[]): string[] {
  const out = [...lines];
  let fence = false;
  for (let i = 0; i < out.length; i += 1) {
    if (FENCE_OPEN.test(out[i] ?? '')) fence = !fence;
    if (fence || !FOOTNOTE_DEFINITION.test(out[i] ?? '')) continue;
    out[i] = '';
    while (CONTINUATION.test(out[i + 1] ?? '')) out[++i] = '';
  }
  return out;
}

/** Hasta dónde llega el bloque que empieza en `start` (índice de la primera línea que ya no es suya). */
function blockEnd(lines: string[], start: number): number {
  const line = lines[start] ?? '';
  const at = (i: number): string => lines[i] ?? '';
  let i = start + 1;

  const fence = FENCE_OPEN.exec(line);
  if (fence) {
    const marker = fence[1] ?? '```';
    while (i < lines.length && !(at(i).trim().startsWith(marker) && /^(`+|~+)$/.test(at(i).trim()))) i += 1;
    return i + 1;
  }
  if (HEADING.test(line) || HR.test(line)) return i;

  if (BLOCKQUOTE.test(line)) {
    while (i < lines.length && (BLOCKQUOTE.test(at(i)) || (!isBlank(at(i)) && !interruptsParagraph(at(i))))) i += 1;
    return i;
  }

  const item = LIST_ITEM.exec(line);
  if (item) {
    const kind = listKind(item[2] ?? '');
    const sibling = (text: string): boolean => listKind(LIST_ITEM.exec(text)?.[2] ?? '') === kind && LIST_ITEM.test(text);
    for (; i < lines.length; i += 1) {
      const text = at(i);
      if (!isBlank(text)) {
        // Indentado = contenido del ítem; si no, otro ítem del mismo tipo o la continuación perezosa de un párrafo.
        const inList = indentOf(text) >= 2 || (LIST_ITEM.test(text) ? sibling(text) : !interruptsParagraph(text));
        if (inList) continue;
        return i;
      }
      // Tras líneas en blanco la lista sigue solo con contenido indentado o con otro ítem del mismo tipo.
      let k = i;
      while (k < lines.length && isBlank(at(k))) k += 1;
      if (k === lines.length || !(indentOf(at(k)) >= 2 || sibling(at(k)))) return i;
      i = k;
    }
    return i;
  }

  if (line.includes('|') && TABLE_DELIMITER.test(at(start + 1))) {
    i = start + 2;
    while (i < lines.length && !isBlank(at(i)) && !FENCE_OPEN.test(at(i)) && !HEADING.test(at(i)) && !BLOCKQUOTE.test(at(i))) i += 1;
    return i;
  }

  while (i < lines.length && !isBlank(at(i)) && !interruptsParagraph(at(i))) i += 1;
  return i;
}

/** La línea donde empieza cada bloque de nivel superior, en orden. */
export function blockStartLines(markdown: string): number[] {
  const lines = withoutFootnoteDefinitions(markdown.replace(/\r\n?/g, '\n').split('\n'));
  const starts: number[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i] ?? '')) {
      i += 1;
      continue;
    }
    starts.push(i);
    i = blockEnd(lines, i);
  }
  return starts;
}

/** Un punto del editor (px de scroll) que corresponde a un punto de la vista previa. */
export interface Anchor {
  readonly source: number;
  readonly target: number;
}

/**
 * Los pares de anclas: el principio, cada bloque con su elemento y el final de ambos scrolls. Con cuentas distintas,
 * solo principio y final (proporcional). Se descartan las que retroceden: el mapeo tiene que ser monótono.
 */
export function pairAnchors(sourceTops: readonly number[], targetTops: readonly number[], end: Anchor): Anchor[] {
  const blocks = sourceTops.length === targetTops.length ? sourceTops.map((source, i) => ({ source, target: targetTops[i] ?? 0 })) : [];
  const sorted = [{ source: 0, target: 0 }, ...blocks, end].sort((a, b) => a.source - b.source);
  const anchors: Anchor[] = [];
  for (const anchor of sorted) {
    const last = anchors[anchors.length - 1];
    if (!last || (anchor.source > last.source && anchor.target >= last.target)) anchors.push(anchor);
  }
  return anchors;
}

/** El scroll de la vista previa para `position` (scroll del editor): interpolación lineal entre anclas. */
export function syncedScrollTop(anchors: readonly Anchor[], position: number): number {
  const next = anchors.findIndex((anchor) => anchor.source > position);
  const after = anchors[next];
  const before = anchors[next === -1 ? anchors.length - 1 : next - 1];
  if (!before) return 0;
  if (!after) return before.target; // más allá del final del editor: el final de la vista previa
  const ratio = (position - before.source) / (after.source - before.source);
  return Math.max(0, before.target + ratio * (after.target - before.target));
}

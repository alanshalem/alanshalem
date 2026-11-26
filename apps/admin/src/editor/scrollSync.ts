/*
 * Scroll sincronizado de la vista dividida (S2). El HTML no marca de qué línea sale cada elemento, así que se mapea
 * por índice de bloque: `blockStarts` del render de @blog/markdown (el mismo recorrido que la vista previa, sin copias
 * de sus expresiones: principio 2, L4) da dónde empieza cada hijo de .prose y la vista previa interpola entre los pares.
 * Si las cuentas no coinciden (la vista previa todavía no se actualizó) cae a proporcional: nunca salta a cualquier lado.
 */

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

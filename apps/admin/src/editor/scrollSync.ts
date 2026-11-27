/*
 * Synced scroll of the split view. The HTML does not mark which line each element comes from, so it maps by element
 * index with lines of the @blog/markdown render (the same pass as the preview, with no copies of its regexes, which
 * drifted before): `anchorLines` gives where each top-level element and each list item (<li>) starts, `blockStarts`
 * only the children of .prose. The preview interpolates between the pairs. A long list is one block, so with blocks
 * alone the preview drifted inside it; the items keep it on track. If the counts do not match (the preview has not
 * updated yet) it falls back to the blocks, then to proportional: it never jumps anywhere.
 */

/** A point of the editor (scroll px) that corresponds to a point of the preview. */
export interface Anchor {
  readonly source: number;
  readonly target: number;
}

/** Editor lines and the preview elements (or their measured tops) that start at them, to pair one to one. */
export interface AnchorSet<T> {
  readonly lines: readonly number[];
  readonly elements: readonly T[];
}

/**
 * The first set, from finest to coarsest, whose counts match (each line has its element); null when none does, and
 * then the scroll is proportional.
 */
export function matchingAnchorSet<T>(sets: readonly AnchorSet<T>[]): AnchorSet<T> | null {
  return sets.find((set) => set.lines.length === set.elements.length) ?? null;
}

/**
 * The anchor pairs: the start, each block with its element and the end of both scrolls. With different counts, only
 * start and end (proportional). Those that go backwards are dropped: the mapping must be monotonic.
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

/** The preview scroll for `position` (editor scroll): linear interpolation between anchors. */
export function syncedScrollTop(anchors: readonly Anchor[], position: number): number {
  const next = anchors.findIndex((anchor) => anchor.source > position);
  const after = anchors[next];
  const before = anchors[next === -1 ? anchors.length - 1 : next - 1];
  if (!before) return 0;
  if (!after) return before.target; // past the end of the editor: the end of the preview
  const ratio = (position - before.source) / (after.source - before.source);
  return Math.max(0, before.target + ratio * (after.target - before.target));
}

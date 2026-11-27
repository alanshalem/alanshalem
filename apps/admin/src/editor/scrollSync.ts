/*
 * Synced scroll of the split view. The HTML does not mark which line each element comes from, so it maps by block
 * index: `blockStarts` of the @blog/markdown render (the same pass as the preview, with no copies of its regexes, which
 * drifted before) gives where each child of .prose starts and the preview interpolates between the pairs. If the counts
 * do not match (the preview has not updated yet) it falls back to proportional: it never jumps anywhere.
 */

/** A point of the editor (scroll px) that corresponds to a point of the preview. */
export interface Anchor {
  readonly source: number;
  readonly target: number;
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

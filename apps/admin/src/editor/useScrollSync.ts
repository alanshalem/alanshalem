import type { RenderResult } from '@blog/markdown';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { matchingAnchorSet, pairAnchors, syncedScrollTop, type Anchor } from './scrollSync.ts';
import { lineOffsets } from './text.ts';
import { measureOffsetTops } from './textareaMetrics.ts';

/** The lines of the preview render the scroll pairs with its elements. */
export type AnchorLines = Pick<RenderResult, 'blockStarts' | 'anchorLines'>;

function computeAnchors(textarea: HTMLTextAreaElement, preview: HTMLElement, lines: AnchorLines): Anchor[] {
  const prose = preview.querySelector('.prose');
  // The renderer appends the footnotes section at the end, not from a block: neither it nor its items are anchors.
  const outsideNotes = (element: Element): boolean => !element.closest('section.footnotes');
  // Document order: the children of .prose and every <li> (`anchorLines`); the children alone (`blockStarts`).
  const elements = Array.from(prose?.querySelectorAll(':scope > *, li') ?? []).filter(outsideNotes);
  const blocks = Array.from(prose?.children ?? []).filter(outsideNotes);
  const set = matchingAnchorSet([
    { lines: lines.anchorLines, elements },
    { lines: lines.blockStarts, elements: blocks },
  ]);
  const end = { source: textarea.scrollHeight - textarea.clientHeight, target: preview.scrollHeight - preview.clientHeight };
  if (!set) return pairAnchors([], [], end);
  const sourceTops = measureOffsetTops(textarea, lineOffsets(textarea.value, set.lines));
  const origin = preview.getBoundingClientRect().top - preview.scrollTop;
  const targetTops = set.elements.map((element) => element.getBoundingClientRect().top - origin);
  return pairAnchors(sourceTops, targetTops, end);
}

/**
 * In the split view, the preview follows the editor: on scroll and on every re-render (the block being typed stays
 * visible on both sides). The anchors are measured once per change and reused. `lines` are the anchors of the editor
 * text the preview render already computed (`RenderResult.anchorLines`, with `blockStarts` as the fallback): nothing
 * is parsed again; `shownHtml` is what the panel shows (the preview or the original).
 */
export function useScrollSync(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  previewRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  shownHtml: string,
  lines: AnchorLines,
) {
  const anchorsRef = useRef<Anchor[] | null>(null);
  // In a ref: it changes on every render and must not re-subscribe the ResizeObserver.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const frameRef = useRef(0);

  const sync = useCallback(() => {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!enabled || !textarea || !preview) return;
    anchorsRef.current ??= computeAnchors(textarea, preview, linesRef.current);
    preview.scrollTop = syncedScrollTop(anchorsRef.current, textarea.scrollTop);
  }, [enabled, textareaRef, previewRef]);

  const invalidate = useCallback(() => {
    anchorsRef.current = null;
    sync();
  }, [sync]);

  // After the new preview is in the DOM (useLayoutEffect: before painting, without jumps).
  useLayoutEffect(invalidate, [shownHtml, lines.anchorLines, lines.blockStarts, invalidate]);

  // Changing the width re-wraps the lines: measure again.
  useEffect(() => {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!enabled || !textarea || !preview) return;
    const observer = new ResizeObserver(invalidate);
    observer.observe(textarea);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [enabled, invalidate, textareaRef, previewRef]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  /** For the textarea's onScroll: at most one sync per frame. */
  return useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(sync);
  }, [sync]);
}

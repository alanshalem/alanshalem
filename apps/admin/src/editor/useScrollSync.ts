import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { pairAnchors, syncedScrollTop, type Anchor } from './scrollSync.ts';
import { lineOffsets } from './text.ts';
import { measureOffsetTops } from './textareaMetrics.ts';

function computeAnchors(textarea: HTMLTextAreaElement, preview: HTMLElement, blockStarts: readonly number[]): Anchor[] {
  const sourceTops = measureOffsetTops(textarea, lineOffsets(textarea.value, blockStarts));
  // The blocks are the children of .prose; the renderer appends the footnotes section at the end, not from a block.
  const blocks = Array.from(preview.querySelector('.prose')?.children ?? []).filter((child) => !child.matches('section.footnotes'));
  const origin = preview.getBoundingClientRect().top - preview.scrollTop;
  const targetTops = blocks.map((block) => block.getBoundingClientRect().top - origin);
  return pairAnchors(sourceTops, targetTops, {
    source: textarea.scrollHeight - textarea.clientHeight,
    target: preview.scrollHeight - preview.clientHeight,
  });
}

/**
 * In the split view, the preview follows the editor: on scroll and on every re-render (the block being typed stays
 * visible on both sides). The anchors are measured once per change and reused. `blockStarts` are the blocks of the
 * editor text the preview render already computed (`RenderResult`): nothing is parsed again; `shownHtml` is what the
 * panel shows (the preview or the original).
 */
export function useScrollSync(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  previewRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  shownHtml: string,
  blockStarts: readonly number[],
) {
  const anchorsRef = useRef<Anchor[] | null>(null);
  // In a ref: it changes on every render and must not re-subscribe the ResizeObserver.
  const blockStartsRef = useRef(blockStarts);
  blockStartsRef.current = blockStarts;
  const frameRef = useRef(0);

  const sync = useCallback(() => {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!enabled || !textarea || !preview) return;
    anchorsRef.current ??= computeAnchors(textarea, preview, blockStartsRef.current);
    preview.scrollTop = syncedScrollTop(anchorsRef.current, textarea.scrollTop);
  }, [enabled, textareaRef, previewRef]);

  const invalidate = useCallback(() => {
    anchorsRef.current = null;
    sync();
  }, [sync]);

  // After the new preview is in the DOM (useLayoutEffect: before painting, without jumps).
  useLayoutEffect(invalidate, [shownHtml, blockStarts, invalidate]);

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

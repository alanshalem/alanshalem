import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { blockStartLines, pairAnchors, syncedScrollTop, type Anchor } from './scrollSync.ts';
import { measureOffsetTops } from './textareaMetrics.ts';

/** Los offsets del texto donde empieza cada línea pedida. */
function lineOffsets(text: string, lines: readonly number[]): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return lines.map((line) => starts[line] ?? text.length);
}

function computeAnchors(textarea: HTMLTextAreaElement, preview: HTMLElement): Anchor[] {
  const sourceTops = measureOffsetTops(textarea, lineOffsets(textarea.value, blockStartLines(textarea.value)));
  // Los bloques son los hijos de .prose; la sección de notas al pie la agrega el renderer al final, no sale de un bloque.
  const blocks = Array.from(preview.querySelector('.prose')?.children ?? []).filter((child) => !child.matches('section.footnotes'));
  const origin = preview.getBoundingClientRect().top - preview.scrollTop;
  const targetTops = blocks.map((block) => block.getBoundingClientRect().top - origin);
  return pairAnchors(sourceTops, targetTops, {
    source: textarea.scrollHeight - textarea.clientHeight,
    target: preview.scrollHeight - preview.clientHeight,
  });
}

/**
 * En la vista dividida, la vista previa sigue al editor: al scrollear y cada vez que se re-renderiza (el bloque que
 * se está escribiendo queda a la vista en los dos lados). Las anclas se miden una vez por cambio y se reusan.
 */
export function useScrollSync(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  previewRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  previewHtml: string,
) {
  const anchorsRef = useRef<Anchor[] | null>(null);
  const frameRef = useRef(0);

  const sync = useCallback(() => {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!enabled || !textarea || !preview) return;
    anchorsRef.current ??= computeAnchors(textarea, preview);
    preview.scrollTop = syncedScrollTop(anchorsRef.current, textarea.scrollTop);
  }, [enabled, textareaRef, previewRef]);

  const invalidate = useCallback(() => {
    anchorsRef.current = null;
    sync();
  }, [sync]);

  // Después de que la vista previa nueva está en el DOM (useLayoutEffect: antes de pintar, sin saltos).
  useLayoutEffect(invalidate, [previewHtml, invalidate]);

  // Cambiar el ancho re-parte las líneas: hay que volver a medir.
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

  /** Para el onScroll del textarea: a lo sumo una sincronización por cuadro. */
  return useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(sync);
  }, [sync]);
}

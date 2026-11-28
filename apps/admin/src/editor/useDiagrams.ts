import { createDiagramRenderer, hasDiagram, type DiagramRenderer } from '@blog/diagrams';
import { loadMermaid } from '@blog/diagrams/mermaid';
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** How long the preview must stay unchanged before a new or edited diagram is drawn (ms). */
const DIAGRAM_DELAY_MS = 400;

/**
 * Draws the Mermaid diagrams of the preview, like the published page (@blog/diagrams, the same theme and text
 * alternative). Mermaid is loaded only the first time a diagram is shown (its own lazy chunks: the admin does not
 * grow at startup). The preview's HTML is replaced on every keystroke: a diagram already drawn comes back at once,
 * before paint (no flash of its source), and a new or edited one is drawn once the typing pauses; while a diagram
 * does not parse, its source shows as code.
 */
export function useDiagrams(previewRef: RefObject<HTMLElement | null>, html: string): void {
  const rendererRef = useRef<DiagramRenderer | null>(null);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview || !hasDiagram(html)) return;
    // The theme comes from the design-system tokens of the preview's sheet (.paper).
    rendererRef.current ??= createDiagramRenderer(loadMermaid, (name) => getComputedStyle(preview).getPropertyValue(name));
    const renderer = rendererRef.current;
    if (renderer.applyCached(preview) === 0) return;
    const timer = setTimeout(() => void renderer.render(preview), DIAGRAM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [previewRef, html]);
}

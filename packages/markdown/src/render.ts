import { renderBlocks } from './blocks.ts';
import { createFootnotes, extractFootnoteDefinitions } from './footnotes.ts';
import type { InlineContext } from './inline.ts';
import { labelsFor } from './labels.ts';
import { plainTextOf } from './plainText.ts';
import { createSlugger } from './slug.ts';
import type { RenderOptions, RenderResult } from './types.ts';

/**
 * Markdown -> { html, headings, blockStarts, text }, en un solo recorrido.
 * Función pura y sin dependencias: corre igual en el navegador (preview del admin)
 * y en Node (build de Astro), por eso lo que se ve en el editor es lo que se publica.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  const headings: RenderResult['headings'] = [];
  const blockStarts: number[] = [];
  const headingOffset = Math.min(5, Math.max(0, options.headingOffset ?? 0));
  const minHeadingLevel = Math.min(6, Math.max(1, options.minHeadingLevel ?? 1));
  const labels = labelsFor(options.lang);

  const { lines, definitions } = extractFootnoteDefinitions(source.replace(/\r\n?/g, '\n').split('\n'));
  const footnotes = createFootnotes(definitions, labels);
  const inline: InlineContext = {
    smartTypography: options.smartTypography ?? false,
    footnoteRef: footnotes.reference,
  };

  const body = renderBlocks(lines, {
    headings,
    slugger: createSlugger(),
    headingOffset,
    minHeadingLevel,
    depth: 0,
    tight: false,
    inline,
    labels,
    figures: options.figures ?? false,
    blockStarts,
  });
  const section = footnotes.renderSection(inline);
  const html = section ? `${body}\n${section}` : body;

  return { html, headings, blockStarts, text: plainTextOf(html) };
}

/**
 * `renderMarkdown(source).blockStarts`: las opciones no mueven los bordes de los bloques, por eso no se piden.
 * Quien además necesita el HTML usa el resultado del render, sin un segundo recorrido.
 */
export function blockStartLines(source: string): number[] {
  return renderMarkdown(source).blockStarts;
}

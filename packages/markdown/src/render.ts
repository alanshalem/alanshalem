import { renderBlocks } from './blocks.ts';
import { createHighlightedCode } from './code.ts';
import { createFootnotes, extractFootnoteDefinitions } from './footnotes.ts';
import type { InlineContext } from './inline.ts';
import { labelsFor } from './labels.ts';
import { createFormulas } from './math.ts';
import { plainTextOf } from './plainText.ts';
import { createSlugger } from './slug.ts';
import type { RenderOptions, RenderResult } from './types.ts';

/**
 * Markdown -> { html, headings, blockStarts, anchorLines, text }, in one pass.
 * A pure function without dependencies: it runs the same in the browser (admin preview) and in Node (Astro build),
 * which is why what the editor shows is what gets published.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  const headings: RenderResult['headings'] = [];
  const blockStarts: number[] = [];
  const anchorLines: number[] = [];
  const headingOffset = Math.min(5, Math.max(0, options.headingOffset ?? 0));
  const minHeadingLevel = Math.min(6, Math.max(1, options.minHeadingLevel ?? 1));
  const labels = labelsFor(options.lang);

  const { lines, definitions } = extractFootnoteDefinitions(source.replace(/\r\n?/g, '\n').split('\n'));
  const footnotes = createFootnotes(definitions, labels);
  const formulas = options.math ? createFormulas(options.math) : null;
  const code = options.highlight ? createHighlightedCode(options.highlight) : null;
  const inline: InlineContext = {
    smartTypography: options.smartTypography ?? false,
    footnoteRef: footnotes.reference,
    math: formulas?.slot ?? null,
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
    code: code?.slot ?? null,
    diagrams: options.diagrams ?? false,
    blockStarts,
    anchorLines,
    lineBase: 0,
  });
  const section = footnotes.renderSection(inline);
  const withSlots = section ? `${body}\n${section}` : body;
  if (!formulas && !code) return { html: withSlots, headings, blockStarts, anchorLines, text: plainTextOf(withSlots) };

  // The slots are filled at the end: formulas and highlighted code in `html`, their sources in the plain text.
  const same = (html: string): string => html;
  const html = (code?.html ?? same)((formulas?.html ?? same)(withSlots));
  const text = plainTextOf((code?.textHtml ?? same)((formulas?.textHtml ?? same)(withSlots)));
  return { html, headings, blockStarts, anchorLines, text };
}

/**
 * `renderMarkdown(source).blockStarts`: the boundaries without options (only `math` moves them, adding display math
 * blocks), so none are taken.
 * A caller that also needs the HTML uses the render result instead, without a second pass.
 */
export function blockStartLines(source: string): number[] {
  return renderMarkdown(source).blockStarts;
}

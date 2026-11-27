import { renderBlocks } from './blocks.ts';
import { createFootnotes, extractFootnoteDefinitions } from './footnotes.ts';
import type { InlineContext } from './inline.ts';
import { labelsFor } from './labels.ts';
import { plainTextOf } from './plainText.ts';
import { createSlugger } from './slug.ts';
import type { RenderOptions, RenderResult } from './types.ts';

/**
 * Markdown -> { html, headings, blockStarts, text }, in one pass.
 * A pure function without dependencies: it runs the same in the browser (admin preview) and in Node (Astro build),
 * which is why what the editor shows is what gets published.
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
 * `renderMarkdown(source).blockStarts`: options never move block boundaries, so none are taken.
 * A caller that also needs the HTML uses the render result instead, without a second pass.
 */
export function blockStartLines(source: string): number[] {
  return renderMarkdown(source).blockStarts;
}

import { renderBlocks } from './blocks.ts';
import { createSlugger } from './slug.ts';
import type { RenderOptions, RenderResult } from './types.ts';

/**
 * Markdown -> { html, headings }.
 * Función pura y sin dependencias: corre igual en el navegador (preview del admin)
 * y en Node (build de Astro), por eso lo que se ve en el editor es lo que se publica.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  const headings: RenderResult['headings'] = [];
  const headingOffset = Math.min(5, Math.max(0, options.headingOffset ?? 0));

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html = renderBlocks(lines, {
    headings,
    slugger: createSlugger(),
    headingOffset,
    depth: 0,
    tight: false,
  });

  return { html, headings };
}

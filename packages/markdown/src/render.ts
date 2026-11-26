import { renderBlocks } from './blocks.ts';
import { createFootnotes, extractFootnoteDefinitions } from './footnotes.ts';
import type { InlineContext } from './inline.ts';
import { labelsFor } from './labels.ts';
import { createSlugger } from './slug.ts';
import type { RenderOptions, RenderResult } from './types.ts';

/**
 * Markdown -> { html, headings }.
 * Función pura y sin dependencias: corre igual en el navegador (preview del admin)
 * y en Node (build de Astro), por eso lo que se ve en el editor es lo que se publica.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  return render(source, options);
}

/**
 * La línea (desde 0) donde empieza cada bloque de nivel superior, en orden: cada uno es un elemento de primer nivel
 * del HTML (la sección de notas al pie, que va al final, no sale de un bloque). Sale del mismo recorrido que el render,
 * así que no puede separarse de él: el admin la usa para el scroll sincronizado y el esquema de títulos.
 * Las opciones no mueven los bordes de los bloques, por eso no se piden.
 */
export function blockStartLines(source: string): number[] {
  const starts: number[] = [];
  render(source, {}, (line) => starts.push(line));
  return starts;
}

function render(source: string, options: RenderOptions, onBlockStart?: (line: number) => void): RenderResult {
  const headings: RenderResult['headings'] = [];
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
    onBlockStart,
  });
  const section = footnotes.renderSection(inline);

  return { html: section ? `${body}\n${section}` : body, headings };
}

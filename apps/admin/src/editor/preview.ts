import {
  readingTimeOfText,
  renderMarkdown,
  wordCount,
  type Heading,
  type RenderOptions,
  type RenderResult,
} from '@blog/markdown';
import { postBodyOptions } from '@blog/math';
import type { Lang } from '../languages.ts';
import { isTopLevelHeading } from './markdownSource.ts';

/**
 * The options the site renders a post body with (`postBodyOptions` of @blog/math, the same the build uses: the post
 * body preset of @blog/markdown, TeX math and the post's language): the preview is what gets published (## = h2,
 * ### = h3, quotes, figures, callout titles, formulas).
 */
export const previewOptions = (lang: Lang): RenderOptions => postBodyOptions(lang);

/**
 * The single render per update: besides the HTML it brings `text` (counter), `headings` + `blockStarts` (outline) and
 * `anchorLines` with `blockStarts` as its fallback (synced scroll), all from the same pass.
 */
export const renderPreview = (markdown: string, lang: Lang): RenderResult => renderMarkdown(markdown, previewOptions(lang));

export interface DocumentStats {
  readonly words: number;
  readonly characters: number;
  readonly readingMinutes: number;
}

/** From the preview's plain text (`RenderResult.text`): what is read, with the site's minutes formula. */
export function documentStats(text: string): DocumentStats {
  return {
    words: wordCount(text),
    characters: [...text].length, // per Unicode code point: an emoji or an accented letter counts as one
    readingMinutes: readingTimeOfText(text),
  };
}

/** An outline heading: the renderer's one and the editor line where it is (null if it could not be located). */
export interface OutlineEntry extends Heading {
  readonly line: number | null;
}

/**
 * The renderer does not say which line each heading comes from, so they are paired in order with the top-level
 * heading blocks (only those have an anchor), split by the same pass as the render (`blockStarts`). If the counts do
 * not match (a rare case), better no line than sending the editor to another heading.
 */
export function outlineEntries(markdown: string, { headings, blockStarts }: Pick<RenderResult, 'headings' | 'blockStarts'>): OutlineEntry[] {
  const source = markdown.replace(/\r\n?/g, '\n').split('\n');
  const lines = blockStarts.filter((line) => isTopLevelHeading(source[line] ?? ''));
  const paired = lines.length === headings.length;
  return headings.map((heading, i) => ({ ...heading, line: paired ? (lines[i] ?? null) : null }));
}

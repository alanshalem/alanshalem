import { escapeHtml } from './escape.ts';

/**
 * Highlighted code (the `highlight` option). The renderer only finds the fenced blocks with a language; turning code
 * into HTML is the injected `CodeHighlighter`'s job, so this package keeps zero dependencies; the site and the admin
 * inject the same one, so the preview is the page.
 *
 * While rendering, each highlighted block leaves a slot `<%n>` inside its `<code>`. User text can never produce one
 * (every `<` of the content is escaped), and the slots are filled at the end: with the highlighter's HTML for `html`,
 * and with the escaped code for the plain text (`text`), so the tags of the highlighting never split its words.
 */

/**
 * Code → HTML for a fenced block with a language (the info string's first word). Null = not highlighted: the code is
 * escaped as always. Its output goes into the page as is: it must be safe.
 */
export type CodeHighlighter = (code: string, language: string) => string | null;

/** The slot a highlighted block leaves in the HTML being built, or null when the highlighter answered null. */
export type CodeSlot = (code: string, language: string) => string | null;

export interface HighlightedCode {
  slot: CodeSlot;
  /** The final HTML: each slot replaced by its highlighted code. */
  html: (withSlots: string) => string;
  /** The HTML for the plain text: each slot replaced by its escaped code, as without the option. */
  textHtml: (withSlots: string) => string;
}

const SLOT = /<%(\d+)>/g;

export function createHighlightedCode(highlight: CodeHighlighter): HighlightedCode {
  const blocks: Array<{ code: string; html: string }> = [];

  const fill = (withSlots: string, each: (block: { code: string; html: string }) => string): string =>
    blocks.length === 0
      ? withSlots
      : withSlots.replace(SLOT, (slot, index: string) => {
          const block = blocks[Number(index)];
          return block ? each(block) : slot;
        });

  return {
    slot(code, language) {
      const html = highlight(code, language);
      if (html === null) return null;
      blocks.push({ code, html });
      return `<%${blocks.length - 1}>`;
    },
    html: (withSlots) => fill(withSlots, (block) => block.html),
    textHtml: (withSlots) => fill(withSlots, (block) => escapeHtml(block.code)),
  };
}

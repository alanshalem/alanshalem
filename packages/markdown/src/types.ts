import type { CodeHighlighter } from './code.ts';
import type { MathRenderer } from './math.ts';

/** A document heading, for building the side table of contents (TOC). */
export interface Heading {
  /** Final level in the HTML (with `headingOffset` and `minHeadingLevel` already applied). */
  level: number;
  /** Value of the <hN> id attribute; it is the anchor (#id). */
  id: string;
  /** Plain text, without Markdown marks. */
  text: string;
}

/** Post language: sets the texts the renderer adds (callout titles, footnotes). */
export type Lang = 'es' | 'en';

export interface RenderOptions {
  /**
   * How much to lower every heading level (`#` → <h2> with 1). For short texts placed under another heading, like the
   * home bio. Clamped to 5. For a post body, see minHeadingLevel.
   */
  headingOffset?: number;
  /**
   * Minimum heading level, after headingOffset. With 2, `#` and `##` become <h2> and `###` <h3>: "## section,
   * ### subsection", like GitHub or Docs, and the <h1> is left for the page title. Clamped to 1..6. Defaults to 1,
   * so existing HTML does not change.
   */
  minHeadingLevel?: number;
  /** Language of the added texts ("Nota" / "Note"...). Defaults to 'es'. */
  lang?: Lang;
  /**
   * Quotes “ ” ‘ ’, dashes – — and … when rendering (never in code, URLs or attributes).
   * Defaults to false so existing HTML does not change; the site and the admin turn it on.
   */
  smartTypography?: boolean;
  /**
   * An image alone in its paragraph and with a title (`![alt](url "caption")`) becomes <figure> + <figcaption>.
   * Defaults to false for the same reason as smartTypography.
   */
  figures?: boolean;
  /**
   * TeX math, GitHub's syntax: `$...$` inline (pandoc's rule: `$5 y $10` stays text), `$$` blocks and ```` ```math ````
   * fences as display math. The renderer finds the formulas and this function turns each into HTML; its output goes
   * into the page as is, so it must be safe (the site and the admin inject @blog/math's). Undefined by default, and
   * then `$` is plain text as always.
   */
  math?: MathRenderer;
  /**
   * Syntax highlighting of fenced code with a language: the renderer passes this function the raw code and the
   * language, and puts its HTML inside the same `<pre tabindex="0"><code class="language-x">`; null keeps the escaped
   * code. Its output goes into the page as is, so it must be safe (the site and the admin inject @blog/highlight's).
   * The plain text (`text`) carries the code, never the highlighting's tags. Undefined by default: code is escaped as
   * always.
   */
  highlight?: CodeHighlighter;
  /**
   * A ````mermaid```` fence becomes `<figure class="diagram">` around its escaped source in
   * `<pre class="diagram-source" tabindex="0"><code class="language-mermaid">`: the browser draws the diagram from it
   * (@blog/diagrams) and, if it cannot, the source stays as a code block and the text alternative. Defaults to false
   * so existing HTML does not change.
   */
  diagrams?: boolean;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  /**
   * The line (from 0) where each top-level block starts, in order: each one is a top-level element of the HTML (the
   * footnotes section at the end does not come from a block). It comes from the same pass as the render, so it cannot
   * drift from it: the admin uses it for the synced scroll and the heading outline.
   */
  blockStarts: number[];
  /**
   * Finer scroll anchors, in document order: the line (from 0) of each top-level block (as `blockStarts`) and of each
   * list item at any depth (also inside quotes and callouts), so one per top-level element and one per `<li>` of the
   * HTML outside the footnotes section. Nondecreasing: a list and its first item share a line. Same pass as the
   * render: the admin pairs it with those elements so the preview follows the editor inside long lists.
   */
  anchorLines: number[];
  /**
   * The plain text of `html` (what is read, without marks): word counter and reading minutes. A formula contributes
   * its TeX source.
   */
  text: string;
}

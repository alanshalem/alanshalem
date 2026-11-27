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
  /** The plain text of `html` (what is read, without marks): word counter and reading minutes. */
  text: string;
}

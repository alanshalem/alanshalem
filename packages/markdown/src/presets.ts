import type { RenderOptions } from './types.ts';

/**
 * How a post body renders. The site build and the admin preview both use it, so what the editor shows is what gets
 * published; each one adds the post language (`{ ...POST_BODY_RENDER_OPTIONS, lang }`).
 * - minHeadingLevel 2: "## section, ### subsection" and a body `#` is a section too; the post title is the page's
 *   only <h1>.
 * - Figures and smart typography: optional in the renderer only so other uses keep their output.
 */
export const POST_BODY_RENDER_OPTIONS = Object.freeze({
  minHeadingLevel: 2,
  smartTypography: true,
  figures: true,
} as const satisfies RenderOptions);

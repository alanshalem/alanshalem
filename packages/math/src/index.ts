import { HIGHLIGHT_RENDER_OPTIONS } from '@blog/highlight';
import { escapeHtml, POST_BODY_RENDER_OPTIONS, type Lang, type MathRenderer, type RenderOptions } from '@blog/markdown';
import temml from 'temml';

/**
 * TeX → MathML with Temml, injected into @blog/markdown's `math` option. MathML needs no runtime script and screen
 * readers read it natively; the browser typesets it with the math font of tokens.css.
 *
 * Safety: Temml escapes all text, and with `trust: false` the commands that could add HTML attributes, links or
 * images (`\class`, `\id`, `\style`, `\data`, `\includegraphics`) are refused; `\href`, `\url` and `\html*` do not
 * exist in it. With `throwOnError` every refused, unknown or invalid formula throws, and it is shown as its escaped
 * source in `<code class="math-error">`: an error never breaks the rest of the page. Temml's `maxExpand` limit turns a
 * macro that never stops expanding into an error too.
 */
export const renderTex: MathRenderer = (tex, display) => {
  try {
    return temml.renderToString(tex, { displayMode: display, trust: false, throwOnError: true });
  } catch {
    return `<code class="math-error">${escapeHtml(tex)}</code>`;
  }
};

/** The math part of the post body options. */
export const MATH_RENDER_OPTIONS = Object.freeze({ math: renderTex } as const satisfies RenderOptions);

/**
 * How a post body renders, on the site build and in the admin preview alike, so the preview is the page:
 * `POST_BODY_RENDER_OPTIONS` of @blog/markdown (diagrams included), the math renderer, the code highlighter of
 * @blog/highlight and the post's language. It lives here because math was the first injected renderer; the site and
 * the admin import it from here.
 */
export const postBodyOptions = (lang: Lang): RenderOptions => ({
  ...POST_BODY_RENDER_OPTIONS,
  ...MATH_RENDER_OPTIONS,
  ...HIGHLIGHT_RENDER_OPTIONS,
  lang,
});

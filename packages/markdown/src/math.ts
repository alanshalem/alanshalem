import { escapeHtml } from './escape.ts';

/**
 * TeX math (the `math` option). The renderer only finds the formulas: `$...$` inline, `$$` display blocks and
 * ```` ```math ```` fences. Turning TeX into HTML is the injected `MathRenderer`'s job, so this package keeps zero
 * dependencies; the site and the admin inject the same one, so the preview is the page.
 *
 * While rendering, each formula leaves a slot `<$n>` in the HTML. User text can never produce one (every `<` of the
 * content is escaped), and the slots are filled at the end: with the renderer's HTML for `html`, and with the TeX
 * source for the plain text (`text`), which would otherwise be the scattered characters of the MathML.
 */

/** TeX → HTML (MathML). `display` is true for display math. Its output goes into the page as is: it must be safe. */
export type MathRenderer = (tex: string, display: boolean) => string;

/** The slot a formula leaves in the HTML being built. */
export type MathSlot = (tex: string, display: boolean) => string;

export interface Formulas {
  slot: MathSlot;
  /** The final HTML: each slot replaced by its formula (display math inside its own scrollable box). */
  html: (withSlots: string) => string;
  /** The HTML for the plain text: each slot replaced by its escaped TeX source. */
  textHtml: (withSlots: string) => string;
}

const SLOT = /<\$(\d+)>/g;
/** A character of the text written against a formula: anything up to a space or a tag. */
const isGlued = (char: string | undefined): boolean => char !== undefined && !/[\s<>]/.test(char);

/**
 * Each slot with the text written against it on each side (`(`, `),`, `.`, quotes) wrapped in a no-wrap span. It
 * looks only around the slots, and never back past the previous match, so each character is visited at most twice:
 * a long run without spaces (base64 in a code block) costs linear time, not quadratic.
 */
function glueSlots(html: string): string {
  const slot = new RegExp(SLOT.source, 'g');
  let out = '';
  let done = 0;
  for (let match = slot.exec(html); match; match = slot.exec(html)) {
    let start = match.index;
    while (start > done && isGlued(html[start - 1])) start -= 1;
    let end = slot.lastIndex;
    while (isGlued(html[end])) end += 1;
    const word = html.slice(start, end);
    out += html.slice(done, start) + (word.length > match[0].length ? `<span class="math-nowrap">${word}</span>` : word);
    done = slot.lastIndex = end;
  }
  return out + html.slice(done);
}

export function createFormulas(render: MathRenderer): Formulas {
  const formulas: Array<{ tex: string; display: boolean }> = [];

  const fill = (withSlots: string, each: (tex: string, display: boolean) => string): string =>
    withSlots.replace(SLOT, (slot, index: string) => {
      const formula = formulas[Number(index)];
      return formula ? each(formula.tex, formula.display) : slot;
    });

  return {
    slot(tex, display) {
      formulas.push({ tex, display });
      return `<$${formulas.length - 1}>`;
    },
    // A long display formula scrolls inside its box, not the page: tabindex makes it keyboard scrollable (WCAG 2.1.1),
    // like <pre>. A line may break before or after an inline <math> (an atomic inline), even right after `(`: the text
    // written against a formula goes in a no-wrap span with it.
    // Without formulas there is no slot: the HTML is returned as is, without a pass over it.
    html: (withSlots) =>
      formulas.length === 0
        ? withSlots
        : fill(glueSlots(withSlots), (tex, display) =>
            display ? `<div class="math-display" tabindex="0">${render(tex, true)}</div>` : render(tex, false),
          ),
    textHtml: (withSlots) =>
      formulas.length === 0 ? withSlots : fill(withSlots, (tex, display) => (display ? ` ${escapeHtml(tex)} ` : escapeHtml(tex))),
  };
}

const DISPLAY_FENCE = /^ {0,3}\$\$[ \t]*$/;
const DISPLAY_ONE_LINE = /^ {0,3}\$\$(.+)\$\$[ \t]*$/;

/**
 * Display math starting at line `start`: a one-line `$$ tex $$`, or a `$$` line, the TeX, and a closing `$$` line with
 * no blank line in between (like pandoc). Unclosed or empty, it is not math and stays text.
 */
export function displayMathAt(lines: string[], start: number): { tex: string; next: number } | null {
  const line = lines[start] ?? '';
  const oneLine = DISPLAY_ONE_LINE.exec(line);
  if (oneLine) {
    const tex = (oneLine[1] ?? '').trim();
    return tex === '' ? null : { tex, next: start + 1 };
  }
  if (!DISPLAY_FENCE.test(line)) return null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const current = lines[i] ?? '';
    if (current.trim() === '') return null;
    if (DISPLAY_FENCE.test(current)) {
      const tex = lines.slice(start + 1, i).join('\n');
      return { tex, next: i + 1 };
    }
  }
  return null;
}

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
    // like <pre>.
    html: (withSlots) =>
      fill(withSlots, (tex, display) =>
        display ? `<div class="math-display" tabindex="0">${render(tex, true)}</div>` : render(tex, false),
      ),
    textHtml: (withSlots) => fill(withSlots, (tex, display) => (display ? ` ${escapeHtml(tex)} ` : escapeHtml(tex))),
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

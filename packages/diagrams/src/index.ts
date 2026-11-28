import type { MermaidConfig } from 'mermaid';

/**
 * Mermaid diagrams of post bodies, drawn in the browser on the published page and in the admin preview alike.
 *
 * @blog/markdown (the `diagrams` option) turns a ```mermaid fence into
 * `<figure class="diagram"><pre class="diagram-source" tabindex="0"><code class="language-mermaid">source</code></pre></figure>`.
 * This module finds those figures, asks Mermaid for each SVG and puts it in the figure: the source stays in the page,
 * hidden, as the diagram's long description, and visible again as a code block when a diagram cannot be drawn.
 *
 * It never imports Mermaid itself: each app passes how to load it (the site, its self-hosted bundle under
 * `MERMAID_SCRIPT_URL`; the admin, a lazy `import('mermaid')` from `@blog/diagrams/mermaid`), so the code that only
 * looks for figures stays a few KB and a page without a diagram never downloads Mermaid.
 *
 * Safety: `securityLevel: 'strict'` (Mermaid sanitizes labels with DOMPurify, no click handlers, no HTML tags other
 * than its allowed ones such as `<br/>`), and the source comes from the renderer, escaped, read back as text.
 */

/** The pinned Mermaid version: the one in package.json and in the self-hosted bundle's path (a test checks the three). */
export const MERMAID_VERSION = '12.4.0';

/** Where the site serves the self-hosted bundle (copied from node_modules at build: `@blog/diagrams/bundle`). */
export const MERMAID_SCRIPT_URL = `/scripts/mermaid-${MERMAID_VERSION}/mermaid.esm.min.mjs`;

/** What the renderer puts around a diagram's source: a page whose HTML has it needs the diagram script. */
const DIAGRAM_FIGURE = '<figure class="diagram">';

/** Does this rendered post body have a diagram? (Only then does the page load the diagram script.) */
export const hasDiagram = (html: string): boolean => html.includes(DIAGRAM_FIGURE);

/**
 * Mermaid's theme variables, each from a design-system token (CSS custom property) read in the page where the diagram
 * is drawn: tokens.css stays the only source. Diagrams sit on the white sheet (`.paper`): dark text on the light
 * fill, lines and borders in the muted gray (≥ 3:1, WCAG 1.4.11; apps/web/test/contrast.test.ts).
 */
export const DIAGRAM_THEME_TOKENS = Object.freeze({
  background: '--paper-bg',
  mainBkg: '--paper-code-bg',
  primaryColor: '--paper-code-bg',
  secondaryColor: '--paper-code-bg',
  tertiaryColor: '--paper-bg',
  clusterBkg: '--paper-bg',
  edgeLabelBackground: '--paper-bg',
  primaryTextColor: '--paper-text',
  secondaryTextColor: '--paper-text',
  tertiaryTextColor: '--paper-text',
  textColor: '--paper-text',
  titleColor: '--paper-text',
  nodeTextColor: '--paper-text',
  primaryBorderColor: '--paper-muted',
  secondaryBorderColor: '--paper-muted',
  tertiaryBorderColor: '--paper-muted',
  nodeBorder: '--paper-muted',
  clusterBorder: '--paper-muted',
  lineColor: '--paper-muted',
  fontFamily: '--font-ui',
} as const);

/** Reads a token (`--paper-text`) where the diagram is drawn. */
export type ReadToken = (name: string) => string;

/** The Mermaid configuration of every diagram, with the theme read from the tokens. */
export function mermaidConfig(readToken: ReadToken): MermaidConfig {
  const themeVariables = Object.fromEntries(
    Object.entries(DIAGRAM_THEME_TOKENS).map(([variable, token]) => [variable, readToken(token).trim()]),
  );
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    // A diagram that does not parse throws: its source stays visible. Mermaid's own error drawing never shows up.
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: themeVariables.fontFamily,
    themeVariables,
  };
}

/**
 * The diagram's accessible name: its labels in order, without repeats, joined with "; " ("1. Finanzas (Reglas…); 5. …").
 * Empty labels are skipped; with none, the name is empty and the source (the description) carries the diagram.
 */
export function diagramLabel(labels: readonly string[]): string {
  const seen = new Set<string>();
  for (const label of labels) {
    const text = label.replace(/\s+/g, ' ').trim();
    if (text !== '') seen.add(text);
  }
  return [...seen].join('; ');
}

/** The part of the Mermaid API this module uses (its default export). */
export interface MermaidApi {
  initialize: (config: MermaidConfig) => void;
  render: (id: string, text: string, container?: Element) => Promise<{ svg: string }>;
}

export type LoadMermaid = () => Promise<MermaidApi>;

/** The state a figure is in, on its `data-diagram` attribute: drawn, or its source shown because it could not be. */
type DiagramState = 'rendered' | 'error';

const SOURCE_SELECTOR = '.diagram-source';
const LABEL_SELECTOR = '.nodeLabel, .edgeLabel, .label, text';

/** The text of a label element with a space where a `<br>` or a tag splits it ("Finanzas<br>(Reglas" → "Finanzas (Reglas"). */
function labelText(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) parts.push(node.textContent ?? '');
    else node.childNodes.forEach(walk);
  };
  walk(element);
  return parts.join(' ');
}

/** The outermost label elements of an SVG (a label inside another one is read with it). */
function labelsOf(svg: Element): string[] {
  const all = [...svg.querySelectorAll(LABEL_SELECTOR)];
  return all.filter((element) => !all.some((other) => other !== element && other.contains(element))).map(labelText);
}

let nextId = 0;

/** How many drawn sources a renderer remembers. */
const MAX_REMEMBERED = 50;

/** Puts an SVG in its figure: an image named by its labels and described by its (now hidden) source. */
function showDiagram(figure: HTMLElement, svgMarkup: string): void {
  const source = figure.querySelector<HTMLElement>(SOURCE_SELECTOR);
  let render = figure.querySelector<HTMLElement>(':scope > .diagram-render');
  if (!render) {
    render = figure.ownerDocument.createElement('div');
    render.className = 'diagram-render';
    figure.prepend(render);
  }
  render.innerHTML = svgMarkup;
  const svg = render.querySelector('svg');
  if (!svg || !source) return;
  svg.setAttribute('role', 'img');
  // Mermaid names and describes the SVG itself when the source has accTitle / accDescr: those win.
  if (!svg.hasAttribute('aria-labelledby')) {
    const label = diagramLabel(labelsOf(svg));
    if (label !== '') svg.setAttribute('aria-label', label);
  }
  if (!svg.hasAttribute('aria-describedby')) {
    source.id ||= `diagram-source-${(nextId += 1)}`;
    svg.setAttribute('aria-describedby', source.id);
  }
  source.hidden = true;
  figure.dataset.diagram = 'rendered' satisfies DiagramState;
}

/** Back to the source as a visible code block (the fallback). */
function showSource(figure: HTMLElement): void {
  figure.querySelector(':scope > .diagram-render')?.remove();
  const source = figure.querySelector<HTMLElement>(SOURCE_SELECTOR);
  if (source) source.hidden = false;
  figure.dataset.diagram = 'error' satisfies DiagramState;
}

const sourceOf = (figure: Element): string => figure.querySelector(SOURCE_SELECTOR)?.textContent ?? '';

/**
 * Loads the diagram font before the first diagram is drawn: Mermaid sizes each box from its label measured in the page,
 * and a label measured with the fallback font overflows its box once the web font arrives.
 */
async function loadFont(readToken: ReadToken): Promise<void> {
  const family = readToken(DIAGRAM_THEME_TOKENS.fontFamily).trim();
  try {
    if (family !== '') await globalThis.document?.fonts?.load(`16px ${family}`);
  } catch {
    // Without the font the diagram is still drawn, with the fallback.
  }
}

export interface DiagramRenderer {
  /**
   * Draws at once, without Mermaid, every figure whose source was already drawn (the admin preview replaces its HTML
   * on every keystroke: unchanged diagrams do not flash back to their source). Returns how many figures still wait.
   */
  applyCached: (root: ParentNode) => number;
  /** Draws every figure not drawn yet (loading Mermaid the first time one is needed). */
  render: (root: ParentNode) => Promise<void>;
}

/**
 * The diagram renderer of a page. `readToken` reads the design-system tokens where the diagrams are (inside `.paper`).
 * Each source is drawn once and remembered (by its text) for the life of the renderer.
 */
export function createDiagramRenderer(load: LoadMermaid, readToken: ReadToken): DiagramRenderer {
  const drawn = new Map<string, string>();
  // The sources drawn while a diagram is being written in the editor: only the latest ones are kept.
  const remember = (source: string, svg: string): void => {
    drawn.delete(source);
    drawn.set(source, svg);
    for (const oldest of drawn.keys()) {
      if (drawn.size <= MAX_REMEMBERED) break;
      drawn.delete(oldest);
    }
  };
  let mermaid: Promise<MermaidApi> | null = null;

  const figuresIn = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('figure.diagram')];
  const pending = (root: ParentNode): HTMLElement[] => figuresIn(root).filter((figure) => figure.dataset.diagram === undefined);

  const applyCached = (root: ParentNode): number => {
    let waiting = 0;
    for (const figure of pending(root)) {
      const svg = drawn.get(sourceOf(figure));
      if (svg === undefined) waiting += 1;
      else showDiagram(figure, svg);
    }
    return waiting;
  };

  const render = async (root: ParentNode): Promise<void> => {
    if (applyCached(root) === 0) return;
    mermaid ??= Promise.all([load(), loadFont(readToken)]).then(([api]) => {
      api.initialize(mermaidConfig(readToken));
      return api;
    });
    let api: MermaidApi;
    try {
      api = await mermaid;
    } catch {
      mermaid = null; // the script did not load (offline, blocked): the sources stay as code; try again next time
      return;
    }
    // One at a time: Mermaid measures each diagram in the page while drawing it.
    for (const figure of pending(root)) {
      const source = sourceOf(figure);
      try {
        const { svg } = await api.render(`diagram-${(nextId += 1)}`, source);
        remember(source, svg);
        if (figure.isConnected && figure.dataset.diagram === undefined) showDiagram(figure, svg);
      } catch {
        if (figure.isConnected) showSource(figure);
      }
    }
  };

  return { applyCached, render };
}

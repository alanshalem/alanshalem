import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDiagramRenderer, type LoadMermaid, type MermaidApi } from '../src/index.ts';

/*
 * createDiagramRenderer against a stub Mermaid API and a minimal DOM stand-in (no browser): what it does with the
 * renderer's figures — drawing, remembering, falling back to the source, retrying, and calls that overlap.
 */

/** A text node of the stand-in DOM. */
class FakeText {
  readonly nodeType = 3;
  readonly childNodes: never[] = [];
  parent: FakeElement | null = null;
  textContent: string;
  constructor(text: string) {
    this.textContent = text;
  }
}

/**
 * The few element features the renderer uses. Selectors: comma lists of `tag`, `.class` or `tag.class`, and
 * `:scope > selector` for direct children.
 */
class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  readonly childNodes: (FakeElement | FakeText)[] = [];
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes = new Map<string, string>();
  parent: FakeElement | null = null;
  className: string;
  hidden = false;
  id = '';

  constructor(document: FakeDocument, tagName: string, className = '') {
    this.ownerDocument = document;
    this.tagName = tagName;
    this.className = className;
  }

  get isConnected(): boolean {
    let node: FakeElement | null = this;
    while (node.parent) node = node.parent;
    return node === this.ownerDocument.body;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  /** Only what the stub Mermaid returns: `<svg><text>label</text>…</svg>`. */
  set innerHTML(markup: string) {
    for (const child of [...this.childNodes]) this.detach(child);
    const svg = new FakeElement(this.ownerDocument, 'svg');
    for (const [, label] of markup.matchAll(/<text>([^<]*)<\/text>/g)) {
      svg.append(new FakeElement(this.ownerDocument, 'text').append(new FakeText(label!)));
    }
    this.append(svg);
  }

  append(child: FakeElement | FakeText): this {
    child.parent?.detach(child);
    child.parent = this;
    this.childNodes.push(child);
    return this;
  }

  prepend(child: FakeElement): void {
    child.parent?.detach(child);
    child.parent = this;
    this.childNodes.unshift(child);
  }

  remove(): void {
    this.parent?.detach(this);
  }

  contains(other: FakeElement): boolean {
    for (let node: FakeElement | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const scoped = selector.match(/^:scope > (.+)$/);
    if (scoped) return this.elements().filter((child) => matches(child, scoped[1]!));
    const found: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      for (const child of element.elements()) {
        if (selector.split(',').some((part) => matches(child, part.trim()))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  private elements(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  private detach(child: FakeElement | FakeText): void {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parent = null;
  }
}

const matches = (element: FakeElement, simple: string): boolean => {
  const [tag, ...classes] = simple.split('.');
  return (tag === '' || element.tagName === tag) && classes.every((name) => element.className.split(' ').includes(name));
};

class FakeDocument {
  readonly body: FakeElement = new FakeElement(this, 'body');
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

/** The renderer's figure around a source: `<figure class="diagram"><pre class="diagram-source"><code>…`. */
function figure(document: FakeDocument, source: string): FakeElement {
  const pre = new FakeElement(document, 'pre', 'diagram-source').append(
    new FakeElement(document, 'code', 'language-mermaid').append(new FakeText(source)),
  );
  return new FakeElement(document, 'figure', 'diagram').append(pre);
}

/** A connected page (or preview) holding one figure per source. */
function page(...sources: string[]): { root: FakeElement; figures: FakeElement[]; document: FakeDocument } {
  const document = new FakeDocument();
  const root = new FakeElement(document, 'div', 'paper');
  document.body.append(root);
  const figures = sources.map((source) => figure(document, source));
  for (const item of figures) root.append(item);
  return { root, figures, document };
}

const asRoot = (element: FakeElement): ParentNode => element as unknown as ParentNode;
const sourceOf = (item: FakeElement): FakeElement => item.querySelector('.diagram-source')!;
const svgOf = (item: FakeElement): FakeElement | null => item.querySelector(':scope > .diagram-render')?.querySelector('svg') ?? null;

/** A Mermaid stand-in: draws `<svg><text>source</text></svg>`, refuses the sources in `failing`, records everything. */
function stubMermaid(options: { failing?: string[]; beforeAnswer?: (source: string) => Promise<void> | void } = {}) {
  const stats = { loads: 0, initialized: 0, rendered: [] as string[], active: 0, maxActive: 0 };
  const api: MermaidApi = {
    initialize: () => {
      stats.initialized += 1;
    },
    render: async (_id, source) => {
      stats.rendered.push(source);
      stats.active += 1;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await options.beforeAnswer?.(source);
        if (options.failing?.includes(source)) throw new Error(`Parse error in ${source}`);
        return { svg: `<svg><text>${source}</text></svg>` };
      } finally {
        stats.active -= 1;
      }
    },
  };
  const load: LoadMermaid = async () => {
    stats.loads += 1;
    return api;
  };
  return { load, stats };
}

const readToken = (name: string): string => (name === '--font-ui' ? '' : `value of ${name}`);

describe('createDiagramRenderer: drawing the figures of a page', () => {
  it('draws each figure as an image named by its labels and described by its hidden source', async () => {
    const mermaid = stubMermaid();
    const { root, figures } = page('flowchart A', 'flowchart B');

    await createDiagramRenderer(mermaid.load, readToken).render(asRoot(root));

    assert.deepEqual(mermaid.stats.rendered, ['flowchart A', 'flowchart B']);
    for (const [index, item] of figures.entries()) {
      const svg = svgOf(item)!;
      assert.equal(item.dataset.diagram, 'rendered');
      assert.equal(svg.getAttribute('role'), 'img');
      assert.equal(svg.getAttribute('aria-label'), ['flowchart A', 'flowchart B'][index]);
      assert.equal(svg.getAttribute('aria-describedby'), sourceOf(item).id);
      assert.equal(sourceOf(item).hidden, true);
    }
    assert.equal(mermaid.stats.loads, 1);
    assert.equal(mermaid.stats.initialized, 1);
  });

  it('a source drawn once is drawn again without Mermaid, at once, in a new copy of the HTML', async () => {
    const mermaid = stubMermaid();
    const renderer = createDiagramRenderer(mermaid.load, readToken);
    await renderer.render(asRoot(page('flowchart A').root));

    const again = page('flowchart A');
    assert.equal(renderer.applyCached(asRoot(again.root)), 0);
    assert.equal(again.figures[0]!.dataset.diagram, 'rendered');
    await renderer.render(asRoot(again.root));
    assert.deepEqual(mermaid.stats.rendered, ['flowchart A']);
  });

  it('remembers the 50 latest sources: the 51st forgets the oldest', async () => {
    const mermaid = stubMermaid();
    const renderer = createDiagramRenderer(mermaid.load, readToken);
    const sources = Array.from({ length: 51 }, (_, index) => `flowchart S${index}`);
    for (const source of sources) await renderer.render(asRoot(page(source).root));

    assert.equal(renderer.applyCached(asRoot(page(sources[0]!).root)), 1, 'the oldest is forgotten');
    for (const source of sources.slice(1)) assert.equal(renderer.applyCached(asRoot(page(source).root)), 0, source);
  });

  it('applyCached draws the remembered figures and counts only those still waiting for Mermaid', async () => {
    const mermaid = stubMermaid();
    const renderer = createDiagramRenderer(mermaid.load, readToken);
    await renderer.render(asRoot(page('flowchart Known').root));
    const { root, figures } = page('flowchart Known', 'flowchart New 1', 'flowchart New 2');
    const drawnBefore = figure(root.ownerDocument, 'flowchart Drawn');
    drawnBefore.dataset.diagram = 'rendered';
    root.append(drawnBefore);

    assert.equal(renderer.applyCached(asRoot(root)), 2);
    assert.deepEqual(figures.map((item) => item.dataset.diagram), ['rendered', undefined, undefined]);
    assert.equal(sourceOf(figures[1]!).hidden, false);
    assert.equal(renderer.applyCached(asRoot(page().root)), 0, 'no figure: nothing waits');
  });

  it('a diagram that does not parse keeps its source visible as code; the others are drawn', async () => {
    const mermaid = stubMermaid({ failing: ['flowchart ->'] });
    const { root, figures } = page('flowchart ->', 'flowchart OK');

    await createDiagramRenderer(mermaid.load, readToken).render(asRoot(root));

    const [bad, good] = figures;
    assert.equal(bad!.dataset.diagram, 'error');
    assert.equal(sourceOf(bad!).hidden, false);
    assert.equal(bad!.querySelector(':scope > .diagram-render'), null);
    assert.equal(good!.dataset.diagram, 'rendered');
  });

  it('when Mermaid fails to load the sources stay as code, and the next render loads it again', async () => {
    const mermaid = stubMermaid();
    let attempts = 0;
    const flaky: LoadMermaid = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return mermaid.load();
    };
    const renderer = createDiagramRenderer(flaky, readToken);
    const { root, figures } = page('flowchart A');

    await renderer.render(asRoot(root));
    assert.equal(figures[0]!.dataset.diagram, undefined);
    assert.equal(sourceOf(figures[0]!).hidden, false);
    assert.equal(mermaid.stats.initialized, 0);

    await renderer.render(asRoot(root));
    assert.equal(attempts, 2);
    assert.equal(figures[0]!.dataset.diagram, 'rendered');
  });

  it('a figure removed while Mermaid draws it is left alone, and its drawing is remembered for the new copy', async () => {
    let removed: FakeElement[] = [];
    const mermaid = stubMermaid({
      failing: ['flowchart Gone bad'],
      beforeAnswer: () => {
        for (const item of removed) item.remove();
      },
    });
    const renderer = createDiagramRenderer(mermaid.load, readToken);
    const { root, figures } = page('flowchart Gone', 'flowchart Gone bad');
    removed = figures;

    await renderer.render(asRoot(root));

    for (const item of figures) {
      assert.equal(item.dataset.diagram, undefined);
      assert.equal(item.querySelector(':scope > .diagram-render'), null);
      assert.equal(sourceOf(item).hidden, false);
    }
    assert.equal(renderer.applyCached(asRoot(page('flowchart Gone').root)), 0);
  });

  it('overlapping render calls load Mermaid once and draw each source once, one diagram at a time', async () => {
    const mermaid = stubMermaid();
    const renderer = createDiagramRenderer(mermaid.load, readToken);
    const { root, figures } = page('flowchart A', 'flowchart B', 'flowchart C');

    await Promise.all([renderer.render(asRoot(root)), renderer.render(asRoot(root)), renderer.render(asRoot(root))]);

    assert.equal(mermaid.stats.loads, 1);
    assert.equal(mermaid.stats.initialized, 1);
    assert.deepEqual(mermaid.stats.rendered, ['flowchart A', 'flowchart B', 'flowchart C']);
    assert.equal(mermaid.stats.maxActive, 1);
    assert.ok(figures.every((item) => item.dataset.diagram === 'rendered' && item.querySelectorAll('svg').length === 1));
  });
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import * as diagrams from '../src/index.ts';
import {
  DIAGRAM_THEME_TOKENS,
  diagramLabel,
  hasDiagram,
  MERMAID_SCRIPT_URL,
  MERMAID_VERSION,
  mermaidConfig,
} from '../src/index.ts';
import {
  copyMermaidBundle,
  installedMermaidVersion,
  MERMAID_BUNDLE_PATH,
  MERMAID_DIST,
  mermaidBundleFile,
  mermaidBundleFiles,
} from '../src/bundle.ts';

/** Mermaid diagrams, drawn in the browser from the renderer's figures: what can be checked without a browser. */

const tokens = readFileSync(new URL(import.meta.resolve('@blog/tokens/tokens.css')), 'utf8');

describe('public API', () => {
  it('exports the renderer factory, the config, the label, the detection, the theme tokens and the pinned version', () => {
    assert.deepEqual(Object.keys(diagrams).sort(), [
      'DIAGRAM_THEME_TOKENS',
      'MERMAID_SCRIPT_URL',
      'MERMAID_VERSION',
      'createDiagramRenderer',
      'diagramLabel',
      'hasDiagram',
      'mermaidConfig',
    ]);
  });
});

describe('hasDiagram: does a rendered post body need the diagram script?', () => {
  it('yes for a mermaid fence with the diagrams option; no otherwise', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```';
    assert.equal(hasDiagram(renderMarkdown(md, { diagrams: true }).html), true);
    assert.equal(hasDiagram(renderMarkdown(md).html), false);
    assert.equal(hasDiagram(renderMarkdown('```js\nx\n```\n\ntext', { diagrams: true }).html), false);
  });

  it('a post that writes the figure tag as text does not count (it is escaped)', () => {
    assert.equal(hasDiagram(renderMarkdown('<figure class="diagram">', { diagrams: true }).html), false);
  });
});

describe('mermaidConfig', () => {
  const config = mermaidConfig((name) => ` value of ${name} `);

  it('strict security, no autostart, no error drawing, the base theme', () => {
    assert.equal(config.securityLevel, 'strict');
    assert.equal(config.startOnLoad, false);
    assert.equal(config.suppressErrorRendering, true);
    assert.equal(config.theme, 'base');
  });

  it('every theme variable comes from its design-system token, trimmed; the font is the UI one', () => {
    const expected = Object.fromEntries(Object.entries(DIAGRAM_THEME_TOKENS).map(([variable, token]) => [variable, `value of ${token}`]));
    assert.deepEqual(config.themeVariables, expected);
    assert.equal(config.fontFamily, 'value of --font-ui');
  });

  it('every token it reads exists in tokens.css', () => {
    for (const token of new Set(Object.values(DIAGRAM_THEME_TOKENS))) {
      assert.match(tokens, new RegExp(String.raw`\s${token}:\s*[^;]+;`), token);
    }
  });
});

describe('diagramLabel: the accessible name of a drawn diagram', () => {
  it("the user's labels in order, whitespace normalized, without repeats or empty ones", () => {
    assert.equal(
      diagramLabel(['1. Finanzas  (Reglas, costos y datos)', ' ', '5. Práctica Quant\n(Investigación y ejecución)', '1. Finanzas (Reglas, costos y datos)']),
      '1. Finanzas (Reglas, costos y datos); 5. Práctica Quant (Investigación y ejecución)',
    );
    assert.equal(diagramLabel([]), '');
  });
});

describe('the pinned Mermaid and its self-hosted bundle', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'blog-diagrams-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  it('package.json pins exactly MERMAID_VERSION, which is the installed one and is in the bundle URL', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.mermaid, MERMAID_VERSION);
    assert.equal(installedMermaidVersion(), MERMAID_VERSION);
    assert.equal(MERMAID_SCRIPT_URL, `/scripts/mermaid-${MERMAID_VERSION}/mermaid.esm.min.mjs`);
    assert.equal(MERMAID_BUNDLE_PATH, `/scripts/mermaid-${MERMAID_VERSION}/`);
  });

  it('the bundle is the minified ESM entry and its chunks, without source maps', () => {
    const files = mermaidBundleFiles();
    assert.equal(files[0], 'mermaid.esm.min.mjs');
    assert.ok(files.length > 10, `${files.length} files`);
    for (const file of files) assert.match(file, /^(mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[\w-]+\.mjs)$/);
  });

  it('copied into a release, every relative import of every file resolves to a copied file', () => {
    const count = copyMermaidBundle(scratch);
    const root = join(scratch, MERMAID_BUNDLE_PATH);
    const files = mermaidBundleFiles();
    assert.equal(count, files.length);
    let imports = 0;
    for (const file of files) {
      const code = readFileSync(join(root, file), 'utf8');
      for (const match of code.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
        const target = resolve(dirname(join(root, file)), match[1]!);
        assert.ok(existsSync(target), `${file} imports ${match[1]}`);
        imports += 1;
      }
    }
    assert.ok(imports > files.length, `${imports} imports checked`);
  });

  it('the dev server serves only the bundle files', () => {
    assert.equal(mermaidBundleFile(MERMAID_SCRIPT_URL), join(MERMAID_DIST, 'mermaid.esm.min.mjs'));
    const chunk = mermaidBundleFiles()[1]!;
    assert.equal(mermaidBundleFile(`${MERMAID_BUNDLE_PATH}${chunk}`), join(MERMAID_DIST, chunk));
    for (const path of [
      `${MERMAID_BUNDLE_PATH}mermaid.esm.min.mjs.map`,
      `${MERMAID_BUNDLE_PATH}../package.json`,
      `${MERMAID_BUNDLE_PATH}mermaid.core.mjs`,
      '/scripts/mermaid-0.0.0/mermaid.esm.min.mjs',
      '/es/',
    ]) {
      assert.equal(mermaidBundleFile(path), null, path);
    }
  });
});

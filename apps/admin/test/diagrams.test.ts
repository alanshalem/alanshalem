import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hasDiagram } from '@blog/diagrams';
import { renderMarkdown } from '@blog/markdown';
import { postBodyOptions } from '@blog/math';
import { renderPreview } from '../src/editor/preview.ts';

/* Code and diagrams in the preview: the same HTML as the page, and Mermaid only loaded when a diagram is shown. */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The user's flowchart: quoted labels with <br/>, -->, style lines. */
const FLOWCHART = [
  '```mermaid',
  'flowchart LR',
  '    A["1. Finanzas<br/>(Reglas, costos y datos)"] --> E["5. Práctica Quant<br/>(Investigación y ejecución)"]',
  '    B["2. Matemáticas<br/>(Probabilidad y estadística)"] --> E',
  '    style A fill:#e8f0fe,stroke:#3b5bdb,color:#1a1a1a',
  '```',
].join('\n');

/** Every .ts/.tsx file under apps/admin/src. */
const sources = (dir = new URL('../src/', import.meta.url)): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(new URL(`${entry.name}/`, dir)) : /\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : [],
  );

describe('the preview renders code and diagrams like the page', () => {
  it('highlighted code and a diagram figure, byte for byte the site HTML', () => {
    const markdown = `\`\`\`python\nimport math\n\`\`\`\n\n${FLOWCHART}\n\n\`\`\`cobol\nDISPLAY "X".\n\`\`\``;
    const preview = renderPreview(markdown, 'es');
    assert.equal(preview.html, renderMarkdown(markdown, postBodyOptions('es')).html);
    assert.match(preview.html, /<code class="language-python"><span class="hljs-keyword">import<\/span> math<\/code>/);
    assert.match(preview.html, /<figure class="diagram"><pre class="diagram-source" tabindex="0"><code class="language-mermaid">flowchart LR/);
    assert.match(preview.html, /<code class="language-cobol">DISPLAY &quot;X&quot;.<\/code>/);
    assert.ok(hasDiagram(preview.html));
  });

  it('the counter reads the code and the diagram source, never the highlighting tags', () => {
    const { text } = renderPreview('```python\nprint("hola mundo")\n```', 'es');
    assert.equal(text, 'print("hola mundo")');
  });
});

describe('Mermaid stays out of the admin bundle until a diagram is shown', () => {
  it('no admin module imports mermaid statically; the hook loads it through @blog/diagrams/mermaid', () => {
    for (const file of sources()) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]mermaid['"]/, file.pathname);
    }
    const hook = read('../src/editor/useDiagrams.ts');
    assert.match(hook, /import \{ loadMermaid \} from '@blog\/diagrams\/mermaid';/);
    const loader = readFileSync(new URL(import.meta.resolve('@blog/diagrams/mermaid')), 'utf8');
    assert.match(loader, /await import\('mermaid'\)/);
    assert.doesNotMatch(loader, /^import (?!type)[^;]*from 'mermaid'/m);
  });

  it('the editor draws the diagrams of what its preview shows (the post or the original)', () => {
    assert.match(read('../src/editor/MarkdownEditor.tsx'), /useDiagrams\(previewRef, shown\.html\);/);
  });

  it('the hook does nothing without a diagram and waits for the typing to pause before drawing a new one', () => {
    const hook = read('../src/editor/useDiagrams.ts');
    assert.match(hook, /if \(!preview \|\| !hasDiagram\(html\)\) return;/);
    assert.match(hook, /setTimeout\(\(\) => void renderer\.render\(preview\), DIAGRAM_DELAY_MS\)/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, POST_BODY_RENDER_OPTIONS, renderMarkdown, type CodeHighlighter, type RenderOptions } from '../src/index.ts';

/*
 * Code blocks behind two opt-in options. `highlight`: an injected function turns a fenced block's code into HTML (the
 * site and the admin inject @blog/highlight's); null keeps the escaped code. `diagrams`: a ```mermaid fence becomes a
 * <figure class="diagram"> whose source is the fallback the browser turns into a diagram (@blog/diagrams).
 */

/** A stand-in highlighter: wraps every word so the tests see exactly what arrived (raw code and language). */
const fakeHighlight: CodeHighlighter = (code, language) =>
  language === 'unknown'
    ? null
    : code.replace(/\w+|\W+/g, (part) => (/\w/.test(part) ? `<span class="k">${part}</span>` : escapeHtml(part)));

const HIGHLIGHT: RenderOptions = { highlight: fakeHighlight };
const html = (md: string, options: RenderOptions = HIGHLIGHT): string => renderMarkdown(md, options).html;

/** The user's flowchart (S4): quoted labels with <br/>, -->, and style lines with fill/stroke/color. */
const USER_FLOWCHART = [
  'flowchart LR',
  '    A["1. Finanzas<br/>(Reglas, costos y datos)"] --> E["5. Práctica Quant<br/>(Investigación y ejecución)"]',
  '    B["2. Matemáticas<br/>(Probabilidad y estadística)"] --> E',
  '    C["3. Programación<br/>(Python y datos)"] --> E',
  '    D["4. Mercados<br/>(Microestructura y riesgo)"] --> E',
  '    style A fill:#e8f0fe,stroke:#3b5bdb,color:#1a1a1a',
  '    style E fill:#fff4e5,stroke:#b42318,color:#1a1a1a',
].join('\n');

describe('highlight option: fenced code with a language', () => {
  it('the injected function gets the raw code and the language; its HTML goes inside the same <pre><code>', () => {
    const calls: Array<[string, string]> = [];
    const spy: CodeHighlighter = (code, language) => {
      calls.push([code, language]);
      return '<span class="k">x</span>';
    };
    assert.equal(
      html('```python\nif a < b:\n    print("hi")\n```', { highlight: spy }),
      '<pre tabindex="0"><code class="language-python"><span class="k">x</span></code></pre>',
    );
    assert.deepEqual(calls, [['if a < b:\n    print("hi")', 'python']]);
  });

  it('null keeps the escaped code, exactly as without the option', () => {
    const md = '```unknown\n<b>a</b> & "c"\n```';
    assert.equal(html(md), '<pre tabindex="0"><code class="language-unknown">&lt;b&gt;a&lt;/b&gt; &amp; &quot;c&quot;</code></pre>');
    assert.deepEqual(renderMarkdown(md, HIGHLIGHT), renderMarkdown(md));
  });

  it('is never called without a language, with an unsafe language, for inline code or for ```math with the math option', () => {
    let called = 0;
    const counting: CodeHighlighter = () => {
      called += 1;
      return '<span>never</span>';
    };
    const options: RenderOptions = { highlight: counting, math: (tex) => `<math>${escapeHtml(tex)}</math>` };
    assert.equal(html('```\nx\n```', options), '<pre tabindex="0"><code>x</code></pre>');
    assert.equal(html('```py{.x}\nx\n```', options), '<pre tabindex="0"><code>x</code></pre>');
    assert.equal(html('a `print(1)` b', options), '<p>a <code>print(1)</code> b</p>');
    assert.equal(html('```math\nx\n```', options), '<div class="math-display" tabindex="0"><math>x</math></div>');
    assert.equal(called, 0);
  });

  it('highlights code inside lists and quotes too', () => {
    assert.equal(
      html('- a\n\n  ```js\n  let x\n  ```\n\n> ```sh\n> ls\n> ```'),
      '<ul>\n<li><p>a</p>\n<pre tabindex="0"><code class="language-js"><span class="k">let</span> <span class="k">x</span></code></pre></li>\n</ul>\n' +
        '<blockquote>\n<pre tabindex="0"><code class="language-sh"><span class="k">ls</span></code></pre>\n</blockquote>',
    );
  });

  it('the plain text, the headings and the block boundaries do not change: they carry the code, not the tags', () => {
    const md = '## Code\n\n```python\nprint("hola mundo")  # saludo\n```\n\ntext';
    const plain = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    const highlighted = renderMarkdown(md, { ...POST_BODY_RENDER_OPTIONS, ...HIGHLIGHT });
    assert.equal(highlighted.text, plain.text);
    assert.equal(highlighted.text, 'Code print("hola mundo") # saludo text');
    assert.deepEqual(highlighted.headings, plain.headings);
    assert.deepEqual(highlighted.blockStarts, plain.blockStarts);
    assert.deepEqual(highlighted.anchorLines, plain.anchorLines);
    assert.notEqual(highlighted.html, plain.html);
  });

  it('user text cannot forge a code slot', () => {
    assert.equal(html('<%0> and <%1>'), '<p>&lt;%0&gt; and &lt;%1&gt;</p>');
    assert.equal(
      html('```js\nx\n```\n\n```\n<%0>\n```'),
      '<pre tabindex="0"><code class="language-js"><span class="k">x</span></code></pre>\n<pre tabindex="0"><code>&lt;%0&gt;</code></pre>',
    );
  });

  it('works next to math: formulas and highlighted code in the same document', () => {
    const options: RenderOptions = { ...HIGHLIGHT, math: (tex) => `<math>${escapeHtml(tex)}</math>` };
    const result = renderMarkdown('Sea $x$.\n\n```py\nx = 1\n```', options);
    assert.equal(
      result.html,
      '<p>Sea <span class="math-nowrap"><math>x</math>.</span></p>\n<pre tabindex="0"><code class="language-py"><span class="k">x</span> = <span class="k">1</span></code></pre>',
    );
    assert.equal(result.text, 'Sea x. x = 1');
  });
});

describe('diagrams option: ```mermaid fences', () => {
  it('a mermaid fence is a figure whose escaped source is the fallback and the text alternative', () => {
    assert.equal(
      html('```mermaid\nflowchart LR\n  A --> B\n```', { diagrams: true }),
      '<figure class="diagram"><pre class="diagram-source" tabindex="0"><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre></figure>',
    );
  });

  it("the user's flowchart: <br/>, quotes and style lines stay text, escaped, in the source", () => {
    const out = html(`\`\`\`mermaid\n${USER_FLOWCHART}\n\`\`\``, { diagrams: true });
    assert.equal(
      out,
      `<figure class="diagram"><pre class="diagram-source" tabindex="0"><code class="language-mermaid">${escapeHtml(USER_FLOWCHART)}</code></pre></figure>`,
    );
    assert.ok(out.includes('A[&quot;1. Finanzas&lt;br/&gt;(Reglas, costos y datos)&quot;]'), out);
    assert.doesNotMatch(out, /<br/);
  });

  it('script in a diagram is text, never a tag', () => {
    const out = html('```mermaid\ngraph TD\n  A["<script>alert(1)</script>"] --> B[<img src=x onerror=alert(1)>]\n```', { diagrams: true });
    assert.doesNotMatch(out, /<script|<img/);
  });

  it('is one top-level block; the plain text is the source; tildes and lists work too', () => {
    const result = renderMarkdown('a\n\n~~~mermaid\ngraph TD\n  A --> B\n~~~\n\nb', { diagrams: true });
    assert.deepEqual(result.blockStarts, [0, 2, 7]);
    assert.equal(result.text, 'a graph TD A --> B b');
    assert.match(html('- x\n\n  ```mermaid\n  graph TD\n  ```', { diagrams: true }), /<li><p>x<\/p>\n<figure class="diagram">/);
  });

  it('wins over the highlighter: a diagram source is never highlighted', () => {
    assert.match(html('```mermaid\ngraph TD\n```', { diagrams: true, ...HIGHLIGHT }), /^<figure class="diagram"><pre class="diagram-source" tabindex="0"><code class="language-mermaid">graph TD<\/code>/);
  });

  it('only the exact `mermaid` language; other fences are code as always', () => {
    assert.equal(html('```Mermaid\nx\n```', { diagrams: true }), '<pre tabindex="0"><code class="language-Mermaid">x</code></pre>');
  });
});

describe('without the options, code renders exactly as before', () => {
  it('a mermaid fence is a code block', () => {
    assert.equal(html('```mermaid\nA --> B\n```', {}), '<pre tabindex="0"><code class="language-mermaid">A --&gt; B</code></pre>');
  });

  it('Markdown without code or diagrams renders byte for byte the same with and without both options', () => {
    const md = '## T\n\n"Hola" -- *x* `c` [a](/b)\n\n- a\n- b\n\n> [!NOTE]\n> n[^1]\n\n[^1]: nota\n\n| a |\n|---|\n| 1 |\n\n```\nplain\n```';
    const plain = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(renderMarkdown(md, { ...POST_BODY_RENDER_OPTIONS, ...HIGHLIGHT, diagrams: true }), plain);
  });

  it('a highlighter that always answers null leaves every document unchanged', () => {
    const md = '```ts\nconst a = 1 < 2;\n```\n\n```mermaid\nx\n```';
    assert.deepEqual(renderMarkdown(md, { highlight: () => null }), renderMarkdown(md));
  });
});

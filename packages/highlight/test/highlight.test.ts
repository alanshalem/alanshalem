import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, renderMarkdown } from '@blog/markdown';
import * as highlight from '../src/index.ts';
import { HIGHLIGHT_LANGUAGES, HIGHLIGHT_RENDER_OPTIONS, highlightCode } from '../src/index.ts';

/** Syntax highlighting of post code blocks at build time: class-based HTML (no inline styles, CSP-safe). */

/** The highlighted HTML without its spans: must be exactly the escaped code. */
const withoutSpans = (html: string): string => html.replace(/<span class="[\w -]+">|<\/span>/g, '');

/** Every tag of an HTML string (opening and closing), as written. */
const tagsOf = (html: string): string[] => html.match(/<[^>]*>/g) ?? [];

/** One snippet per language, with what at least one token must be. */
const SAMPLES: Record<string, { code: string; token: string }> = {
  python: { code: 'def area(r):\n    return 3.14 * r ** 2  # circle', token: '<span class="hljs-keyword">def</span>' },
  javascript: { code: 'const total = items.reduce((a, b) => a + b, 0);', token: '<span class="hljs-keyword">const</span>' },
  typescript: { code: 'interface Point { x: number }\nconst p: Point = { x: 1 };', token: '<span class="hljs-keyword">interface</span>' },
  csharp: { code: 'public sealed record Post(string Title);', token: '<span class="hljs-keyword">public</span>' },
  bash: { code: 'for f in *.md; do echo "$f"; done', token: '<span class="hljs-keyword">for</span>' },
  shell: { code: '$ ls -la\ntotal 0', token: '<span class="hljs-meta prompt_">$ </span>' },
  sql: { code: 'SELECT id, title FROM posts WHERE lang = \'es\';', token: '<span class="hljs-keyword">SELECT</span>' },
  json: { code: '{ "name": "blog", "private": true }', token: '<span class="hljs-attr">&quot;name&quot;</span>' },
  yaml: { code: 'services:\n  api:\n    image: blog-api', token: '<span class="hljs-attr">services:</span>' },
  xml: { code: '<p class="lead">Hola</p>', token: '<span class="hljs-name">p</span>' },
  css: { code: '.prose pre { color: #e1e4e8; }', token: '<span class="hljs-selector-class">.prose</span>' },
  markdown: { code: '## Title\n\n**bold**', token: '<span class="hljs-section">## Title</span>' },
  go: { code: 'func main() { fmt.Println("hi") }', token: '<span class="hljs-keyword">func</span>' },
  rust: { code: 'fn main() { let x: i32 = 1; }', token: '<span class="hljs-keyword">fn</span>' },
  java: { code: 'public class Main { }', token: '<span class="hljs-keyword">public</span>' },
  c: { code: '#include <stdio.h>\nint main(void) { return 0; }', token: '<span class="hljs-type">int</span>' },
  cpp: { code: 'std::vector<int> v{1, 2};', token: '<span class="hljs-type">int</span>' },
  dockerfile: { code: 'FROM node:22\nRUN corepack enable', token: '<span class="hljs-keyword">FROM</span>' },
  diff: { code: '-old line\n+new line', token: '<span class="hljs-addition">+new line</span>' },
  r: { code: 'x <- c(1, 2, 3)\nmean(x)', token: '<span class="hljs-operator">&lt;-</span>' },
  powershell: { code: 'Get-ChildItem -Path . | Where-Object { $_.Length -gt 0 }', token: '<span class="hljs-built_in">Get-ChildItem</span>' },
  ini: { code: '[server]\nport = 8080', token: '<span class="hljs-section">[server]</span>' },
};

describe('public API', () => {
  it('exports highlightCode, HIGHLIGHT_RENDER_OPTIONS and HIGHLIGHT_LANGUAGES', () => {
    assert.deepEqual(Object.keys(highlight).sort(), ['HIGHLIGHT_LANGUAGES', 'HIGHLIGHT_RENDER_OPTIONS', 'highlightCode']);
    assert.deepEqual(HIGHLIGHT_RENDER_OPTIONS, { highlight: highlightCode });
    assert.ok(Object.isFrozen(HIGHLIGHT_RENDER_OPTIONS));
  });

  it('the curated languages, by their canonical name', () => {
    assert.deepEqual([...HIGHLIGHT_LANGUAGES].sort(), [...Object.keys(SAMPLES), 'plaintext'].sort());
  });
});

describe('highlightCode', () => {
  for (const [language, { code, token }] of Object.entries(SAMPLES)) {
    it(`${language}: class-based spans around the escaped code`, () => {
      const out = highlightCode(code, language);
      assert.ok(out?.includes(token), `${language}: ${out}`);
      assert.equal(withoutSpans(out ?? ''), escapeHtml(code));
    });
  }

  it('the aliases a post uses resolve to their language, in any case', () => {
    const aliases: Record<string, string> = {
      py: 'python', js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
      cs: 'csharp', 'c#': 'csharp', sh: 'bash', zsh: 'bash', console: 'shell', yml: 'yaml', html: 'xml', svg: 'xml',
      md: 'markdown', golang: 'go', rs: 'rust', h: 'c', 'c++': 'cpp', hpp: 'cpp', docker: 'dockerfile', patch: 'diff',
      ps1: 'powershell', pwsh: 'powershell', toml: 'ini', Python: 'python', JSON: 'json',
    };
    for (const [alias, language] of Object.entries(aliases)) {
      const sample = SAMPLES[language]!;
      assert.equal(highlightCode(sample.code, alias), highlightCode(sample.code, language), alias);
    }
  });

  it('plain text and unknown languages are not highlighted: the renderer escapes them as always', () => {
    for (const language of ['plaintext', 'text', 'txt', 'cobol', 'mermaid', 'math', '']) {
      assert.equal(highlightCode('a < b', language), null, language);
    }
  });

  it('never an inline style, a script or another tag: only spans with classes', () => {
    const nasty = `<script>alert('x')</script> & "q" </span><span class="x" style="color:red"> \${a} \`b\` {{c}}`;
    for (const language of HIGHLIGHT_LANGUAGES) {
      const out = highlightCode(nasty, language);
      if (out === null) continue;
      assert.equal(withoutSpans(out), escapeHtml(nasty), language);
      for (const tag of tagsOf(out)) assert.match(tag, /^(<span class="(hljs-[\w-]+|[\w-]+_|language-[\w-]+)( [\w-]+)*">|<\/span>)$/, `${language}: ${tag}`);
      assert.doesNotMatch(tagsOf(out).join(''), /style=|<script/i, language);
    }
  });
});

describe('through the renderer (the post body wiring)', () => {
  it('a python block is highlighted inside its <pre><code>; the plain text is the code', () => {
    const md = '```python\ndef f(x):\n    return x  # id\n```';
    const result = renderMarkdown(md, HIGHLIGHT_RENDER_OPTIONS);
    assert.match(result.html, /^<pre tabindex="0"><code class="language-python"><span class="hljs-keyword">def<\/span> <span class="hljs-title function_">f<\/span>/);
    assert.equal(result.text, renderMarkdown(md).text);
  });

  it('an unknown language and a block without one render exactly as without highlighting', () => {
    const md = '```cobol\nDISPLAY "HI".\n```\n\n```\n<b>x</b>\n```';
    assert.deepEqual(renderMarkdown(md, HIGHLIGHT_RENDER_OPTIONS), renderMarkdown(md));
  });
});

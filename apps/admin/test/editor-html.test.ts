import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlToMarkdown } from '../src/editor/htmlToMarkdown.ts';

/* Pasting HTML (Google Docs, a web page) converts to clean Markdown; without real formatting, the plain text is pasted. */

const md = (html: string): string => htmlToMarkdown(html).markdown;
const B = '\\';

describe('htmlToMarkdown: blocks', () => {
  it('paragraphs, headings and separator', () => {
    assert.equal(md('<h1>T</h1><p>One</p><hr><h3>S</h3><p>Two</p>'), '## T\n\nOne\n\n---\n\n### S\n\nTwo');
  });

  // The h1 is the post title; what gets pasted (a Doc with its "Heading 1") comes in as a section.
  it('headings: h1 and h2 → ##, h3 → ###, h4 to h6 → ####', () => {
    assert.equal(
      md('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>'),
      '## a\n\n## b\n\n### c\n\n#### d\n\n#### e\n\n#### f',
    );
  });

  it('<br> is a hard line break inside the paragraph', () => {
    assert.equal(md('<p>a<br>b</p>'), `a${B}\nb`);
    assert.equal(md('<p>a<br></p>'), 'a', 'a trailing <br> leaves no stray backslash');
  });

  it('nested, numbered and start lists', () => {
    assert.equal(md('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>'), '- a\n  - b\n- c');
    assert.equal(md('<ol><li>one</li><li>two<ol><li>x</li></ol></li></ol>'), '1. one\n2. two\n   1. x');
    assert.equal(md('<ol start="3"><li>c</li><li>d</li></ol>'), '3. c\n4. d');
  });

  it('a list inside another without <li> (Google Docs) nests under the previous item', () => {
    assert.equal(md('<ul><li><p>a</p></li><ul><li><p>b</p></li></ul></ul>'), '- a\n  - b');
  });

  it('quote with several paragraphs', () => {
    assert.equal(md('<blockquote><p>a</p><p>b</p></blockquote>'), '> a\n>\n> b');
  });

  it('code block: the text untouched, with the language from the class', () => {
    assert.equal(
      md('<pre><code class="language-js">const a = 1;\nif (a &lt; 2) {}\n</code></pre>'),
      '```js\nconst a = 1;\nif (a < 2) {}\n```',
    );
    assert.equal(md('<pre>```\nx</pre>'), '````\n```\nx\n````', 'a fence inside lengthens the outer one');
  });

  it('simple table: the first row is the header; the | in cells are escaped', () => {
    assert.equal(
      md('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>x|y</td></tr></tbody></table>'),
      `| A | B |\n| --- | --- |\n| 1 | x${B}|y |`,
    );
    assert.equal(md('<table><tr><td>a<br>b</td></tr></table>'), '| a b |\n| --- |');
  });
});

describe('htmlToMarkdown: inline', () => {
  it('bold, italic, strikethrough and code', () => {
    assert.equal(md('<p>Hello <strong>world</strong> and <em>everyone</em></p>'), 'Hello **world** and *everyone*');
    assert.equal(md('<b>a</b> <i>b</i> <s>c</s> <del>d</del> <code>e*f</code>'), '**a** *b* ~~c~~ ~~d~~ `e*f`');
    assert.equal(md('<code>a`b</code>'), '``a`b``', 'a backtick inside lengthens the delimiter');
    assert.equal(md('<code>`x</code>'), '`` `x ``', 'at the edge, a space as well');
  });

  it('edge spaces stay outside the markers; repeated formatting is not duplicated', () => {
    assert.equal(md('a<b> x </b>b'), 'a **x** b');
    assert.equal(md('<b>a <strong>b</strong></b>'), '**a b**');
    assert.equal(md('<b> </b>x'), 'x');
  });

  it('links and images with safe URLs', () => {
    assert.equal(md('<a href="https://x.com/a">site</a>'), '[site](https://x.com/a)');
    assert.equal(md('<a href="/a b">x</a>'), '[x](/a%20b)');
    assert.equal(md('<img src="https://x.com/a.png" alt="A cat">'), '![A cat](https://x.com/a.png)');
  });

  it('javascript:/data: links are dropped (the text stays); unsafe images disappear', () => {
    assert.equal(md('<a href="javascript:alert(1)">bad</a>'), 'bad');
    assert.equal(md('<a href=" JaVa&#83;cript:alert(1)">bad</a>'), 'bad');
    assert.equal(md('<a href="data:text/html,x">bad</a>'), 'bad');
    assert.equal(md('<p>a<img src="data:image/png;base64,AAAA" alt="x">b</p>'), 'ab');
  });

  it('entities and collapsed spaces', () => {
    assert.equal(md('<p>&lt;tag&gt; &amp; &quot;x&quot;&nbsp;&#8212; &#x2014;</p>'), '<tag> & "x" — —');
    assert.equal(md('<p>  a\n   b  </p>'), 'a b');
  });

  it('text that looks like Markdown is escaped', () => {
    assert.equal(
      md('<p>#II. not a heading</p><p>1. neither</p><p>- nor this</p><p>a*b snake_case _x_ [y] ~~z~~</p>'),
      `${B}#II. not a heading\n\n1${B}. neither\n\n${B}- nor this\n\na${B}*b snake_case ${B}_x${B}_ ${B}[y${B}] ${B}~${B}~z${B}~${B}~`,
    );
  });
});

describe('htmlToMarkdown: cleanup', () => {
  it('script, style, head and comments are removed with their content', () => {
    assert.equal(
      md('<!--StartFragment--><style>p{color:red}</style><p>ok<script>alert("<p>x</p>")</script></p><!--EndFragment-->'),
      'ok',
    );
    assert.equal(md('<html><head><title>T</title></head><body><p>x</p></body></html>'), 'x');
  });

  it('unknown wrappers and attributes are dropped', () => {
    assert.equal(md('<div class="x"><section><font color="red">text</font> <o:p></o:p></section></div>'), 'text');
  });

  it('Google Docs: the wrapping <b> with normal font-weight is not bold; styled spans are', () => {
    const docs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr">' +
      '<span style="font-weight:700;">Bold</span><span style="font-weight:400;"> and </span>' +
      '<span style="font-style:italic;">italic</span> <span style="text-decoration:line-through;">no</span>' +
      '</p></b><br class="Apple-interchange-newline">';
    assert.deepEqual(htmlToMarkdown(docs), { markdown: '**Bold** and *italic* ~~no~~', formatted: true });
  });

  it('without real formatting (only paragraphs, breaks, unstyled spans) there is nothing to convert: formatted = false', () => {
    assert.equal(htmlToMarkdown('<p>just text</p><p>another</p>').formatted, false);
    assert.equal(htmlToMarkdown('<span>a</span><br><span style="color:red">b</span>').formatted, false);
    assert.equal(htmlToMarkdown('').formatted, false);
    assert.equal(htmlToMarkdown('<p>a <a href="https://x.com">b</a></p>').formatted, true);
  });
});

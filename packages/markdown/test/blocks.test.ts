import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blockStartLines,
  POST_BODY_RENDER_OPTIONS,
  readingTimeMinutes,
  readingTimeOfText,
  renderMarkdown,
  toPlainText,
  wordCount,
} from '../src/index.ts';

/*
 * blockStartLines: the line where each top-level block starts, with the same rules as the render because it comes
 * from the same pass. The admin uses it for the synced scroll and the heading outline; it used to copy the regexes of
 * blocks.ts and they had already drifted.
 */

/** How many top-level elements the HTML has, without the footnotes section (it does not come from a block). */
function topLevelElements(html: string): number {
  const VOID = new Set(['hr', 'br', 'img', 'input', 'source']);
  let depth = 0;
  let count = 0;
  for (const [, closing, tag = ''] of html.replace(/\n<section class="footnotes"[\s\S]*$/, '').matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (closing) depth -= 1;
    else {
      if (depth === 0) count += 1;
      if (!VOID.has(tag)) depth += 1;
    }
  }
  return count;
}

describe('blockStartLines', () => {
  it('heading, multi-line paragraph, list, code with a blank line, lazy quote, table and rule', () => {
    const source = [
      '# T', '', 'párrafo', 'sigue', '', '- a', '- b', '', '```', 'x', '', 'y', '```',
      '> cita', 'perezosa', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '---',
    ].join('\n');
    assert.deepEqual(blockStartLines(source), [0, 2, 5, 8, 13, 16, 20]);
  });

  it('footnote definitions are not blocks; CRLF counts the same; empty = none', () => {
    assert.deepEqual(blockStartLines('a[^1]\n\n[^1]: nota\n    sigue\n\nb'), [0, 5]);
    assert.deepEqual(blockStartLines('a\r\n\r\nb'), [0, 2]);
    assert.deepEqual(blockStartLines(''), []);
  });

  it('code and table boundaries are the ones of the render', () => {
    assert.deepEqual(blockStartLines('```\n    ```\nx\n```\n\nfin'), [0, 5]);
    assert.deepEqual(blockStartLines('a | b\n---\ntexto'), [0, 1, 2]);
    assert.deepEqual(blockStartLines('``` a`b\n\n# T'), [0, 2]);
  });

  it('one block per top-level element of the HTML', () => {
    for (const markdown of [
      '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x\n\n| a | b |\n|---|---|\n| 1 | 2 |',
      'texto[^n]\n\n[^n]: nota\n\n````\n```\n````\n\n***\n\n> cita\nperezosa\n\n- a\n* b\n\n2024. no es lista',
    ]) {
      const { html } = renderMarkdown(markdown, POST_BODY_RENDER_OPTIONS);
      assert.equal(blockStartLines(markdown).length, topLevelElements(html), markdown);
    }
  });
});

/*
 * One render per update: the result carries the block boundaries and the plain text of that same pass, so the admin
 * does not parse again for the counter, the outline and the scroll.
 */
describe('renderMarkdown: blockStarts and text from the same pass', () => {
  const SAMPLES = [
    '# T\n\npárrafo\nsigue\n\n- a\n- b\n\n```\nx\n\ny\n```\n> cita\nperezosa\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---',
    'a[^1]\n\n[^1]: nota\n    sigue\n\nb',
    'a\r\n\r\nb',
    '',
    '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x',
  ];

  it('blockStarts equals blockStartLines, with the post body options too', () => {
    for (const md of SAMPLES) {
      assert.deepEqual(renderMarkdown(md, POST_BODY_RENDER_OPTIONS).blockStarts, blockStartLines(md), md);
      assert.deepEqual(renderMarkdown(md).blockStarts, blockStartLines(md), md);
    }
  });

  it('text is the plain text of that render: without options, equal to toPlainText', () => {
    for (const md of SAMPLES) assert.equal(renderMarkdown(md).text, toPlainText(md), md);
    assert.equal(renderMarkdown('a & b < **c**').text, 'a & b < c');
  });

  it('text follows the options: typography, figures and callout language', () => {
    const { text } = renderMarkdown('"hola" -- y...\n\n![a](/a.png "Pie")\n\n> [!NOTE]\n> x', { ...POST_BODY_RENDER_OPTIONS, lang: 'en' });
    assert.equal(text, '“hola” – y… Pie Note x');
  });

  it('html and headings do not change (new fields are only added)', () => {
    const md = '## Título\n\nUn párrafo con **negrita**.';
    const result = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(Object.keys(result), ['html', 'headings', 'blockStarts', 'text']);
    assert.equal(result.html, '<h2 id="titulo">Título</h2>\n<p>Un párrafo con <strong>negrita</strong>.</p>');
    assert.deepEqual(result.headings, [{ level: 2, id: 'titulo', text: 'Título' }]);
  });
});

describe('wordCount and readingTimeOfText: the minutes formula over a plain text already computed', () => {
  it('counts the words of the plain text; empty = 0', () => {
    assert.equal(wordCount('Una frase con link.'), 4);
    assert.equal(wordCount(''), 0);
  });

  it('readingTimeOfText gives the same as readingTimeMinutes over the render text', () => {
    for (const md of ['corto', 'palabra '.repeat(450), '', Array(401).fill('palabra').join(' ')]) {
      assert.equal(readingTimeOfText(renderMarkdown(md).text), readingTimeMinutes(md), md);
    }
    assert.equal(readingTimeOfText('palabra '.repeat(450).trim(), 100), 5);
  });
});

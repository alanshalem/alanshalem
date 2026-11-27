import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blockStartLines,
  escapeHtml,
  POST_BODY_RENDER_OPTIONS,
  readingTimeMinutes,
  readingTimeOfText,
  renderMarkdown,
  toPlainText,
  wordCount,
  type RenderOptions,
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
    assert.deepEqual(Object.keys(result), ['html', 'headings', 'blockStarts', 'anchorLines', 'text']);
    assert.equal(result.html, '<h2 id="titulo">Título</h2>\n<p>Un párrafo con <strong>negrita</strong>.</p>');
    assert.deepEqual(result.headings, [{ level: 2, id: 'titulo', text: 'Título' }]);
  });
});

/*
 * anchorLines: the synced scroll's finer anchors. A long list is one top-level block, so with blockStarts alone the
 * preview interpolates linearly inside it and drifts; every list item, at any depth, is an anchor too.
 */

/** A stand-in for the real math renderer (the line bookkeeping does not depend on its output). */
const MATH: RenderOptions = {
  math: (tex, display) => (display ? `<math display="block">${escapeHtml(tex)}</math>` : `<math>${escapeHtml(tex)}</math>`),
};

/** The elements the admin measures: the top-level ones and every <li>, both without the footnotes section. */
function anchorElements(html: string): number {
  const body = html.replace(/\n<section class="footnotes"[\s\S]*$/, '');
  return topLevelElements(body) + (body.match(/<li[ >]/g) ?? []).length;
}

describe('renderMarkdown: anchorLines, every top-level block and every list item', () => {
  it('nested lists: each item, at any depth, anchors at its marker line (the list and its first item share one)', () => {
    const md = ['### Bloque IV', '', '1. uno', '   - a', '   - b', '2. dos', '   - c', '     - d', '', '### Bloque V'].join('\n');
    const result = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(result.blockStarts, [0, 2, 9], 'blockStarts keeps its meaning');
    assert.deepEqual(result.anchorLines, [0, 2, 2, 3, 4, 5, 6, 7, 9]);
  });

  it('loose items, lazy continuations and a start number other than 1', () => {
    assert.deepEqual(renderMarkdown('- a\n\n  b\n\n- c\nsigue\n- d').anchorLines, [0, 0, 4, 6]);
    assert.deepEqual(renderMarkdown('texto\n\n3. tres\n4. cuatro').anchorLines, [0, 2, 2, 3]);
  });

  it('lists inside quotes and callouts: their items are anchors, with the lines of the source', () => {
    const md = '> cita\n> - a\n> - b\n\n> [!NOTE]\n> - x\n>   - y';
    assert.deepEqual(renderMarkdown(md, POST_BODY_RENDER_OPTIONS).anchorLines, [0, 1, 2, 4, 5, 6]);
    assert.deepEqual(renderMarkdown('- > - a\n  > - b').anchorLines, [0, 0, 0, 1]);
  });

  it('math: display blocks are top-level anchors; math inside an item does not add one', () => {
    assert.deepEqual(renderMarkdown('a\n$$\nx\n$$\n- b', MATH).anchorLines, [0, 1, 4, 4]);
    assert.deepEqual(renderMarkdown('- a\n  $$\n  x\n  $$\n- b $y$', MATH).anchorLines, [0, 0, 4]);
    assert.deepEqual(renderMarkdown('```math\nx\n```\n\n1. $z$', MATH).anchorLines, [0, 4, 4]);
  });

  it('footnotes: definitions and the notes section are not anchors; lines after them keep their number', () => {
    const md = 'a[^1]\n\n- b\n\n[^1]: nota\n    sigue\n\n- c';
    const result = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(result.blockStarts, [0, 2], 'the definition lines are blanked: the loose list goes on');
    assert.deepEqual(result.anchorLines, [0, 2, 2, 7]);
  });

  it('one anchor per measured element (top-level ones + every <li>), in document order, never going back', () => {
    const samples = [
      '### T\n\n1. uno\n   - a\n     1. b\n2. dos\n\n> - q\n\n> [!TIP]\n> 1. t\n\ntexto[^n]\n\n[^n]: nota',
      '- a\n\n  - b\n\n  c\n- d\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n```\n- no\n```',
      '1. $x$\n   $$\n   y\n   $$\n2. b\n\n$$ z $$',
      'a\r\n\r\n- b\r\n  - c',
      '',
    ];
    for (const md of samples) {
      const { html, anchorLines } = renderMarkdown(md, { ...POST_BODY_RENDER_OPTIONS, ...MATH });
      assert.equal(anchorLines.length, anchorElements(html), md);
      assert.deepEqual(anchorLines, [...anchorLines].sort((a, b) => a - b), md);
    }
  });

  it('without lists, anchorLines equals blockStarts (nothing changes for those documents)', () => {
    const samples = [
      '# T\n\npárrafo\nsigue\n\n```\nx\n\ny\n```\n> cita\nperezosa\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---',
      'a[^1]\n\n[^1]: nota\n\nb',
      '> [!NOTE]\n> caja',
      '',
    ];
    for (const md of samples) {
      const result = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
      assert.deepEqual(result.anchorLines, result.blockStarts, md);
    }
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

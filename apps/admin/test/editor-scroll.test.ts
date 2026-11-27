import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockStartLines } from '@blog/markdown';
import { matchingAnchorSet, pairAnchors, syncedScrollTop } from '../src/editor/scrollSync.ts';
import { renderPreview } from '../src/editor/preview.ts';

/** How many elements are at the top level of the HTML (the children of .prose), without the footnotes section. */
function topLevelElements(html: string): number {
  const VOID = new Set(['hr', 'br', 'img', 'input', 'source']);
  let depth = 0;
  let count = 0;
  const blocks = html.replace(/\n<section class="footnotes"[\s\S]*$/, '');
  for (const [, closing, tag = ''] of blocks.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (closing) depth -= 1;
    else {
      if (depth === 0) count += 1;
      if (!VOID.has(tag)) depth += 1;
    }
  }
  return count;
}

/*
 * Synced scroll: the Markdown is split into top-level blocks with `blockStartLines` of @blog/markdown (the same pass
 * as the render; each one is a child element of .prose) and the preview interpolates between the pairs.
 */

describe('blockStartLines: where each top-level block starts', () => {
  it('heading, multi-line paragraph, list, code with a blank line, lazy quote, table and rule', () => {
    const source = [
      '# T', '', 'párrafo', 'sigue', '', '- a', '- b', '', '```', 'x', '', 'y', '```',
      '> cita', 'perezosa', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '---',
    ].join('\n');
    assert.deepEqual(blockStartLines(source), [0, 2, 5, 8, 13, 16, 20]);
  });

  it('a heading interrupts the paragraph; "#II." without a space is not a heading; "2024." does not open a list', () => {
    assert.deepEqual(blockStartLines('texto\n## T'), [0, 1]);
    assert.deepEqual(blockStartLines('#II. no\nsigue'), [0]);
    assert.deepEqual(blockStartLines('a\n2024. fue'), [0]);
  });

  it('lists: indented continuation after a blank line; another marker kind is another list', () => {
    assert.deepEqual(blockStartLines('- a\n\n  b\n- c\n\notro'), [0, 5]);
    assert.deepEqual(blockStartLines('- a\n1. b'), [0, 1]);
  });

  it('footnote definitions are not blocks (the renderer takes them out); CRLF counts the same', () => {
    assert.deepEqual(blockStartLines('a[^1]\n\n[^1]: nota\n    sigue\n\nb'), [0, 5]);
    assert.deepEqual(blockStartLines('a\r\n\r\nb'), [0, 2]);
  });

  it('empty text: no blocks', () => {
    assert.deepEqual(blockStartLines(''), []);
  });

  // The cases where a former copy of the renderer's regexes had already drifted from blocks.ts.
  it('a code fence close indented 4 spaces does not close (it is still code)', () => {
    assert.deepEqual(blockStartLines('```\n    ```\nx\n```\n\nfin'), [0, 5]);
  });

  it('a table with a different column count in the separator is a paragraph and a rule', () => {
    assert.deepEqual(blockStartLines('a | b\n---\ntexto'), [0, 1, 2]);
  });

  it('``` with a backtick in the info string does not open code', () => {
    assert.deepEqual(blockStartLines('``` a`b\n\n# T'), [0, 2]);
  });

  it('each block is a child of the preview: the same count as the renderer HTML', () => {
    const markdown = '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    assert.equal(blockStartLines(markdown).length, topLevelElements(renderPreview(markdown, 'es').html));
  });

  it('the scroll uses the blocks of the same preview render (no second pass)', () => {
    const markdown = '# T\n\ntexto[^1]\n\n[^1]: nota\n\n- a\n- b\n\n```\nx\n```';
    const preview = renderPreview(markdown, 'es');
    assert.deepEqual(preview.blockStarts, blockStartLines(markdown));
    assert.equal(preview.blockStarts.length, topLevelElements(preview.html));
  });
});

describe('pairAnchors + syncedScrollTop', () => {
  it('with the same number of blocks, each editor block lines up with its own', () => {
    const anchors = pairAnchors([0, 100, 400], [0, 300, 500], { source: 600, target: 1000 });
    assert.equal(syncedScrollTop(anchors, 100), 300);
    assert.equal(syncedScrollTop(anchors, 250), 400, 'interpolates between two blocks');
    assert.equal(syncedScrollTop(anchors, 600), 1000, 'at the end of the editor, the end of the preview');
  });

  it('if the blocks do not match (the text changed and the preview did not), it falls back to proportional', () => {
    const anchors = pairAnchors([0, 100], [0, 300, 500], { source: 200, target: 1000 });
    assert.equal(syncedScrollTop(anchors, 50), 250);
  });

  it('anchors that go backwards are ignored and the result is never negative', () => {
    const anchors = pairAnchors([0, 100, 200], [0, 500, 400], { source: 300, target: 600 });
    assert.equal(syncedScrollTop(anchors, 100), 500);
    assert.equal(syncedScrollTop(anchors, 200), 550, 'the block that goes backwards does not count: it interpolates to the end');
    assert.equal(syncedScrollTop(pairAnchors([], [], { source: 0, target: 0 }), 10), 0);
  });
});

/*
 * Inside a long list the blocks are too coarse: a list is one block, so the preview interpolated linearly between its
 * start and the next heading and drifted (the editor showed "### Bloque V" mid-screen while the preview was still in
 * the previous list). The renderer's `anchorLines` adds every list item; the editor measures the top-level elements
 * and every <li> of the preview, and falls back to the blocks, then to proportional, when the counts differ.
 */
describe('list items are anchors too (anchorLines)', () => {
  /** The elements useScrollSync measures for `anchorLines`: top-level ones and every <li>, without the footnotes. */
  const anchorElements = (html: string): number => {
    const body = html.replace(/\n<section class="footnotes"[\s\S]*$/, '');
    return topLevelElements(body) + (body.match(/<li[ >]/g) ?? []).length;
  };

  // "### Bloque IV", a numbered list whose third item is long, "### Bloque V". Lines → editor px / preview px.
  const SAMPLE = [
    '### Bloque IV', '', '1. uno', '   - a', '2. dos', '3. un ítem largo con $x^2$ que ocupa muchas líneas', '', '### Bloque V',
  ].join('\n');
  const EDITOR_TOP: Record<number, number> = { 0: 0, 2: 40, 3: 80, 4: 120, 5: 160, 7: 1000 };
  const PREVIEW_TOP: Record<number, number> = { 0: 0, 2: 60, 3: 100, 4: 140, 5: 180, 7: 500 };
  const END = { source: 1400, target: 900 };

  it('the render gives one anchor line per element the preview measures (real math too)', () => {
    const preview = renderPreview(SAMPLE, 'es');
    assert.deepEqual(preview.anchorLines, [0, 2, 2, 3, 4, 5, 7]);
    assert.equal(preview.anchorLines.length, anchorElements(preview.html));
  });

  it("a list item's top in the editor maps to that item's top in the preview", () => {
    const { anchorLines, blockStarts } = renderPreview(SAMPLE, 'es');
    const set = matchingAnchorSet([
      { lines: anchorLines, elements: anchorLines.map((line) => PREVIEW_TOP[line] ?? 0) },
      { lines: blockStarts, elements: blockStarts.map((line) => PREVIEW_TOP[line] ?? 0) },
    ]);
    assert.ok(set);
    const anchors = pairAnchors(set.lines.map((line) => EDITOR_TOP[line] ?? 0), set.elements, END);
    assert.equal(syncedScrollTop(anchors, 160), 180, 'the long item at the top of the editor is at the top of the preview');
    assert.equal(syncedScrollTop(anchors, 1000), 500, 'and so is the next heading');
    const blocksOnly = pairAnchors(blockStarts.map((line) => EDITOR_TOP[line] ?? 0), blockStarts.map((line) => PREVIEW_TOP[line] ?? 0), END);
    assert.notEqual(syncedScrollTop(blocksOnly, 160), 180, 'with blocks alone it interpolated across the whole list');
  });

  it('counts that do not match fall back to the blocks, then to proportional', () => {
    const fine = { lines: [0, 2, 2, 3], elements: [0, 60, 60] };
    const blocks = { lines: [0, 2], elements: [0, 60] };
    assert.equal(matchingAnchorSet([fine, blocks]), blocks);
    assert.equal(matchingAnchorSet([fine, { lines: [0, 2], elements: [0] }]), null);
    assert.deepEqual(pairAnchors([], [], END), [{ source: 0, target: 0 }, END], 'no set: start and end only');
  });

  it('without lists the anchors are exactly the blocks, as before', () => {
    const markdown = '# T\n\npárrafo\n\n> cita\n\n```\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx\n$$\n\ntexto[^1]\n\n[^1]: nota';
    const { anchorLines, blockStarts, html } = renderPreview(markdown, 'es');
    assert.deepEqual(anchorLines, blockStarts);
    const tops = blockStarts.map((_, i) => i * 100);
    const set = matchingAnchorSet([{ lines: anchorLines, elements: tops }, { lines: blockStarts, elements: tops }]);
    assert.deepEqual(set?.lines, blockStarts);
    assert.equal(anchorElements(html), topLevelElements(html));
  });
});

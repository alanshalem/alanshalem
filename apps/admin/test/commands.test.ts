import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blockSpan,
  changeIndent,
  continueMarkdownBlock,
  insertCodeBlock,
  insertHorizontalRule,
  imageMarkdown,
  insertBlock,
  insertLink,
  insertTable,
  insertText,
  pasteUrlAsLink,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrike,
} from '../src/editor/commands.ts';
import { renderPreview } from '../src/editor/preview.ts';
import { commandForKey } from '../src/editor/shortcuts.ts';
import { applyEditToState } from '../src/editor/text.ts';
import type { Command, EditorState } from '../src/editor/types.ts';

/*
 * Test notation: «text» = selection, ¦ = caret.
 *   run(toggleBold, 'hello «world»')  ->  'hello **«world»**'
 */
function parse(text: string): EditorState {
  const open = text.indexOf('«');
  if (open !== -1) {
    const close = text.indexOf('»');
    const value = text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1);
    return { value, start: open, end: close - 1 };
  }
  const cursor = text.indexOf('¦');
  assert.notEqual(cursor, -1, 'the test text needs « » or ¦');
  return { value: text.replace('¦', ''), start: cursor, end: cursor };
}

function show({ value, start, end }: EditorState): string {
  if (start === end) return `${value.slice(0, start)}¦${value.slice(start)}`;
  return `${value.slice(0, start)}«${value.slice(start, end)}»${value.slice(end)}`;
}

function run(command: Command, text: string): string {
  const state = parse(text);
  const edit = command(state);
  return edit === null ? 'null' : show(applyEditToState(state, edit));
}

describe('inline formatting', () => {
  it('wraps the selection', () => {
    assert.equal(run(toggleBold, 'hello «world»'), 'hello **«world»**');
    assert.equal(run(toggleItalic, 'hello «world»'), 'hello *«world»*');
    assert.equal(run(toggleCode, 'hello «world»'), 'hello `«world»`');
    assert.equal(run(toggleStrike, 'hello «world»'), 'hello ~~«world»~~');
  });

  it('without a selection it inserts the pair and leaves the caret in the middle', () => {
    assert.equal(run(toggleBold, 'a¦b'), 'a**¦**b');
  });

  it('unwraps when the markers are inside the selection', () => {
    assert.equal(run(toggleBold, '«**a**»'), '«a»');
  });

  it('unwraps when the markers are right outside', () => {
    assert.equal(run(toggleBold, '**«a»**'), '«a»');
    assert.equal(run(toggleItalic, '*«a»*'), '«a»');
  });

  it('italic over bold does not undo it: it adds a layer', () => {
    assert.equal(run(toggleItalic, '**«a»**'), '***«a»***');
  });

  it('bold over bold+italic only removes the bold', () => {
    assert.equal(run(toggleBold, '***«a»***'), '*«a»*');
  });

  it('edge spaces of the selection stay outside the markers', () => {
    assert.equal(run(toggleBold, '«hello »world'), '**«hello»** world');
  });
});

describe('headings', () => {
  it('adds the prefix and keeps the caret column', () => {
    assert.equal(run(setHeading(2), 'tit¦le'), '## tit¦le');
  });

  it('the same level removes it', () => {
    assert.equal(run(setHeading(2), '## ti¦tle'), 'ti¦tle');
  });

  it('changes the level', () => {
    assert.equal(run(setHeading(3), '# a¦'), '### a¦');
  });

  it('only touches the caret line', () => {
    assert.equal(run(setHeading(2), 'one\ntw¦o\nthree'), 'one\n## tw¦o\nthree');
  });
});

describe('lists and quotes', () => {
  it('bullets over several lines', () => {
    assert.equal(run(toggleBulletList, '«one\ntwo»'), '«- one\n- two»');
  });

  it('a second time removes them', () => {
    assert.equal(run(toggleBulletList, '«- one\n- two»'), '«one\ntwo»');
  });

  it('a numbered list increments and skips blank lines', () => {
    assert.equal(run(toggleNumberedList, '«a\n\nb»'), '«1. a\n\n2. b»');
  });

  it('switching from bullets to numbers replaces the prefix', () => {
    assert.equal(run(toggleNumberedList, '«- a\n- b»'), '«1. a\n2. b»');
  });

  it('on an empty line it adds the prefix and leaves the caret after it', () => {
    assert.equal(run(toggleBulletList, '¦'), '- ¦');
  });

  it('with a caret it keeps the relative position', () => {
    assert.equal(run(toggleBulletList, 'he¦llo'), '- he¦llo');
  });

  it('quote', () => {
    assert.equal(run(toggleQuote, '«a\nb»'), '«> a\n> b»');
    assert.equal(run(toggleQuote, '«> a\n> b»'), '«a\nb»');
  });

  it('a selection ending right after a line break does not include the next line', () => {
    const state: EditorState = { value: 'a\nb', start: 0, end: 2 }; // "a\n"
    const edit = toggleBulletList(state);
    assert.equal(applyEditToState(state, edit!).value, '- a\nb');
  });
});

describe('indentation', () => {
  it('Tab nests a bullet item with 2 spaces', () => {
    assert.equal(run(changeIndent(1), '- a\n- ¦b'), '- a\n  - ¦b');
  });

  it('Tab nests a numbered item under the marker width', () => {
    assert.equal(run(changeIndent(1), '1. a\n2. ¦b'), '1. a\n   2. ¦b');
  });

  it('Shift+Tab un-nests', () => {
    assert.equal(run(changeIndent(-1), '  - ¦b'), '- ¦b');
  });

  it('Shift+Tab without indentation does nothing', () => {
    assert.equal(run(changeIndent(-1), '- ¦b'), 'null');
  });

  it('outside lists, with a caret, returns null (Tab keeps moving focus)', () => {
    assert.equal(run(changeIndent(1), 'te¦xt'), 'null');
  });

  it('with several lines selected it indents all of them', () => {
    assert.equal(run(changeIndent(1), '«a\nb»'), '«  a\n  b»');
  });
});

describe('Enter in lists and quotes', () => {
  it('continues a bullet', () => {
    assert.equal(run(continueMarkdownBlock, '- a¦'), '- a\n- ¦');
  });

  it('continues a numbered list, incrementing', () => {
    assert.equal(run(continueMarkdownBlock, '1. a¦'), '1. a\n2. ¦');
    assert.equal(run(continueMarkdownBlock, '9) a¦'), '9) a\n10) ¦');
  });

  it('keeps the indentation', () => {
    assert.equal(run(continueMarkdownBlock, '  - a¦'), '  - a\n  - ¦');
  });

  it('splits the line if the caret is in the middle', () => {
    assert.equal(run(continueMarkdownBlock, '- ab¦cd'), '- ab\n- ¦cd');
  });

  it('an empty item ends the list', () => {
    assert.equal(run(continueMarkdownBlock, 'x\n- a\n- ¦'), 'x\n- a\n¦');
  });

  it('continues quotes and ends them when empty', () => {
    assert.equal(run(continueMarkdownBlock, '> q¦'), '> q\n> ¦');
    assert.equal(run(continueMarkdownBlock, '> ¦'), '¦');
  });

  it('outside lists, with a selection or with the caret inside the marker: normal Enter', () => {
    assert.equal(run(continueMarkdownBlock, 'plain¦'), 'null');
    assert.equal(run(continueMarkdownBlock, '- «a»'), 'null');
    assert.equal(run(continueMarkdownBlock, '-¦ a'), 'null');
  });

  it('a line starting with ** is not mistaken for a bullet', () => {
    assert.equal(run(continueMarkdownBlock, '**bold**¦'), 'null');
  });
});

describe('links and images', () => {
  it('a link over selected text leaves the url selected', () => {
    assert.equal(run(insertLink.es, '«words»'), '[words](«url»)');
  });

  it('a link over a selected URL leaves the text selected', () => {
    assert.equal(run(insertLink.es, '«https://x.com»'), '[«texto»](https://x.com)');
  });

  it('a link without a selection', () => {
    assert.equal(run(insertLink.es, '¦'), '[«texto»](url)');
  });

  it('Ctrl+K with the caret inside an existing link selects its url to edit it', () => {
    assert.equal(run(insertLink.es, 'see [si¦te](https://x.com) and more'), 'see [site](«https://x.com») and more');
    assert.equal(run(insertLink.es, '[a](ht¦tp://x) [b](y)'), '[a](«http://x») [b](y)');
    assert.equal(run(insertLink.es, '[a](x) ¦outside'), '[a](x) [«texto»](url)outside');
  });

  it('pasting a URL over selected text creates the link', () => {
    assert.equal(run(pasteUrlAsLink('https://x.com'), '«hello»'), '[hello](https://x.com)¦');
  });

  it('pasting a URL without a selection, or plain text, is a normal paste', () => {
    assert.equal(run(pasteUrlAsLink('https://x.com'), 'a¦'), 'null');
    assert.equal(run(pasteUrlAsLink('hello'), '«a»'), 'null');
  });

  it('image: empty alt, alt with brackets and a URL with spaces', () => {
    assert.equal(imageMarkdown('/img/a.png', ''), '![](/img/a.png)');
    assert.equal(imageMarkdown('/img/a.png', ' a [cat] '), '![a  cat](/img/a.png)');
    assert.equal(imageMarkdown('/my photo.png', 'x'), '![x](</my photo.png>)');
  });

  it('insertText replaces the selection and leaves the caret at the end', () => {
    assert.equal(run(insertText('**x**'), 'a «b» c'), 'a **x**¦ c');
  });
});

describe('blocks', () => {
  it('empty code block at the start of the document', () => {
    assert.equal(run(insertCodeBlock, '¦'), '```\n¦\n```');
  });

  it('a code block after a paragraph is separated by a blank line', () => {
    assert.equal(run(insertCodeBlock, 'text¦'), 'text\n\n```\n¦\n```');
  });

  it('the code block wraps the selection and leaves it selected', () => {
    assert.equal(run(insertCodeBlock, '«x = 1»'), '```\n«x = 1»\n```');
  });

  it('table and horizontal rule', () => {
    assert.equal(run(insertTable.es, '¦'), '| «Columna» | Columna |\n| --- | --- |\n| Dato | Dato |');
    assert.equal(run(insertHorizontalRule, 'a¦'), 'a\n\n---¦');
  });

  it('adds no extra line breaks if there are blank lines already', () => {
    assert.equal(run(insertHorizontalRule, 'a\n\n¦'), 'a\n\n---¦');
  });
});

/*
 * Pasted or dropped images as their own block: before, they were inserted inline at the caret, stuck to the next word
 * and could never be a figure.
 */
describe('insertBlock: a pasted or dropped image in its own paragraph', () => {
  const image = insertBlock('![x](/m.webp)');

  it('in the middle of a sentence: a blank line before and after, without the edge space', () => {
    const state = { value: 'start finish', start: 6, end: 6 };
    const edit = image(state);
    assert.ok(edit);
    assert.equal(applyEditToState(state, edit).value, 'start\n\n![x](/m.webp)\n\nfinish');
    assert.equal(run(image, 'start ¦finish'), 'start\n\n![x](/m.webp)\n\n¦finish');
  });

  it('no extra blank lines at the start or the end of the document', () => {
    assert.equal(run(image, '¦'), '![x](/m.webp)¦');
    assert.equal(run(image, '¦text'), '![x](/m.webp)\n\n¦text');
    assert.equal(run(image, 'text¦'), 'text\n\n![x](/m.webp)¦');
  });

  it('reuses the blank lines already there and completes the missing ones', () => {
    assert.equal(run(image, 'a\n\n¦\n\nb'), 'a\n\n![x](/m.webp)¦\n\nb');
    assert.equal(run(image, 'a\n¦b'), 'a\n\n![x](/m.webp)\n\n¦b');
    assert.equal(run(image, 'a\n\n![1](/1.webp)\n\n¦b'), 'a\n\n![1](/1.webp)\n\n![x](/m.webp)\n\n¦b');
  });

  it('replaces the selection', () => {
    assert.equal(run(image, 'a «sel» b'), 'a\n\n![x](/m.webp)\n\n¦b');
  });

  it('alone in its paragraph, with a title it becomes a figure', () => {
    const titled = run(insertBlock('![x](/m.webp "Caption")'), 'start ¦finish').replace('¦', '');
    assert.match(renderPreview(titled, 'es').html, /<figure>/);
  });
});

describe('blockSpan: removing a block without leaving extra blank lines (the failed upload)', () => {
  const remove = (value: string, block: string): string => {
    const from = value.indexOf(block);
    const span = blockSpan(value, from, from + block.length);
    return value.slice(0, span.from) + value.slice(span.to);
  };

  it('undoes what insertBlock added', () => {
    assert.equal(remove('start\n\nPH\n\nfinish', 'PH'), 'start\n\nfinish');
    assert.equal(remove('PH\n\nfinish', 'PH'), 'finish');
    assert.equal(remove('start\n\nPH', 'PH'), 'start');
    assert.equal(remove('PH', 'PH'), '');
  });

  it('if text was typed on its line meanwhile, it removes only the block', () => {
    assert.equal(remove('start\nabcPH\n\nfinish', 'PH'), 'start\nabc\n\nfinish');
    assert.equal(remove('start\n\nPHx', 'PH'), 'start\n\nx');
  });
});

describe('keyboard shortcuts', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    commandForKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });

  it('Ctrl/Cmd + B, I, E, K', () => {
    assert.equal(key('b', { ctrlKey: true }), toggleBold);
    assert.equal(key('B', { metaKey: true }), toggleBold);
    assert.equal(key('i', { ctrlKey: true }), toggleItalic);
    assert.equal(key('e', { ctrlKey: true }), toggleCode);
    assert.equal(key('k', { ctrlKey: true }), insertLink.es);
  });

  it('Mod+Shift+X strikethrough; other Shift combinations do nothing', () => {
    assert.equal(key('x', { ctrlKey: true, shiftKey: true }), toggleStrike);
    assert.equal(key('b', { ctrlKey: true, shiftKey: true }), null);
  });

  it('Enter and Tab; Shift+Enter and Alt are left alone', () => {
    assert.equal(key('Enter'), continueMarkdownBlock);
    assert.equal(key('Enter', { shiftKey: true }), null);
    assert.equal(key('Tab') !== null, true);
    assert.equal(key('b', { ctrlKey: true, altKey: true }), null);
  });

  it('a plain key triggers nothing', () => {
    assert.equal(key('a'), null);
  });
});

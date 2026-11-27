import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import { postBodyOptions, renderTex } from '@blog/math';
import { availableActions, editorActions, inPalette } from '../src/editor/actions.ts';
import { insertCallout, insertFigure, insertFootnote } from '../src/editor/commands.ts';
import { CALLOUT_KINDS } from '../src/editor/markdownSource.ts';
import { documentStats, outlineEntries, previewOptions, renderPreview } from '../src/editor/preview.ts';
import { applyEditToState, lineOffsets } from '../src/editor/text.ts';
import type { Command, EditorState } from '../src/editor/types.ts';

/* The site's Markdown in the editor, a preview faithful to the site, counter and outline. Notation: «sel», ¦ caret. */

function parse(text: string): EditorState {
  const open = text.indexOf('«');
  if (open !== -1) {
    const close = text.indexOf('»');
    return { value: text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1), start: open, end: close - 1 };
  }
  const cursor = text.indexOf('¦');
  return { value: text.replace('¦', ''), start: cursor, end: cursor };
}

function run(command: Command, text: string): string {
  const state = parse(text);
  const edit = command(state);
  if (!edit) return 'null';
  const { value, start, end } = applyEditToState(state, edit);
  return start === end ? `${value.slice(0, start)}¦${value.slice(start)}` : `${value.slice(0, start)}«${value.slice(start, end)}»${value.slice(end)}`;
}

describe('footnote: reference at the caret and definition at the end with the next free number', () => {
  it('the first footnote', () => {
    assert.equal(run(insertFootnote.es, 'Hola¦ mundo'), 'Hola[^1] mundo\n\n[^1]: «texto»');
    assert.equal(run(insertFootnote.en, '¦'), '[^1]\n\n[^1]: «text»');
  });

  it('with existing footnotes: the number after the largest, and the definition next to the others', () => {
    assert.equal(run(insertFootnote.es, 'a[^1] b¦\n\n[^1]: uno\n'), 'a[^1] b[^2]\n\n[^1]: uno\n[^2]: «texto»');
    assert.equal(run(insertFootnote.es, 'a[^nota] b[^3]¦'), 'a[^nota] b[^3][^4]\n\n[^4]: «texto»');
  });

  it('with selected text, the reference goes after the selection (it does not delete it)', () => {
    assert.equal(run(insertFootnote.es, '«hola» mundo'), 'hola[^1] mundo\n\n[^1]: «texto»');
  });

  it('the result renders as a footnote', () => {
    const { value } = applyEditToState(parse('Hola¦'), insertFootnote.es(parse('Hola¦'))!);
    assert.match(renderMarkdown(value).html, /class="footnote-ref"/);
  });
});

describe('callouts', () => {
  it('without text: the callout with the placeholder selected', () => {
    assert.equal(run(insertCallout('note').es, '¦'), '> [!NOTE]\n> «texto»');
    assert.equal(run(insertCallout('tip').en, 'a\n\n¦'), 'a\n\n> [!TIP]\n> «text»');
  });

  it('wraps the selected lines (or the caret line)', () => {
    assert.equal(run(insertCallout('tip').es, 'a\n\n«b\nc»'), 'a\n\n> [!TIP]\n> «b\n> c»');
    assert.equal(run(insertCallout('warning').es, 'uno ¦dos'), '> [!WARNING]\n> «uno dos»');
  });

  it('every kind is one the renderer recognizes (the admin kinds do not drift from @blog/markdown)', () => {
    for (const kind of CALLOUT_KINDS) {
      const { value } = applyEditToState(parse('¦'), insertCallout(kind).es(parse('¦'))!);
      assert.match(renderMarkdown(value).html, new RegExp(`class="callout callout-${kind}"`), kind);
    }
  });
});

describe('figure with caption', () => {
  it('as its own block, with the url selected to paste it', () => {
    assert.equal(run(insertFigure.es, '¦'), '![descripción](«url» "epígrafe")');
    assert.equal(run(insertFigure.en, 'a¦'), 'a\n\n![description](«url» "caption")');
  });

  it('with figures enabled it renders as <figure> + <figcaption>', () => {
    const html = renderPreview('![Un gato](/media/gato.webp "Foto: Ana")', 'es').html;
    assert.match(html, /<figure>[\s\S]*<figcaption>Foto: Ana<\/figcaption>/);
  });
});

describe('registry: the new actions reach the toolbar and the palette', () => {
  const actions = editorActions('es');
  const ids = (list: readonly { id: string }[]) => list.map((action) => action.id);

  it('footnote, callout, figure in the toolbar; the three callout kinds in the palette', () => {
    const toolbar = ids(actions.filter((action) => action.toolbar));
    for (const id of ['footnote', 'callout.note', 'figure', 'compare']) assert.ok(toolbar.includes(id), id);
    const palette = ids(actions.filter(inPalette));
    for (const id of ['footnote', 'callout.note', 'callout.tip', 'callout.warning', 'figure']) assert.ok(palette.includes(id), id);
  });

  it('availableActions: without upload there is no image; without another version there is no "view original"', () => {
    assert.ok(!ids(availableActions(actions, { canUpload: false, canCompare: false })).some((id) => id === 'image' || id === 'compare'));
    const all = ids(availableActions(actions, { canUpload: true, canCompare: true }));
    assert.ok(all.includes('image') && all.includes('compare'));
    assert.equal(availableActions(actions, { canUpload: true, canCompare: true }).length, actions.length);
  });
});

describe('preview with the same options as the site', () => {
  it('post language, smart typography, figures, standard headings and math', () => {
    assert.deepEqual(previewOptions('en'), { minHeadingLevel: 2, lang: 'en', smartTypography: true, figures: true, math: renderTex });
    assert.deepEqual(previewOptions('es'), postBodyOptions('es'));
    const html = renderPreview('# Hola\n\n## Sección\n\n### Sub\n\n"citas" -- y...\n\n> [!NOTE]\n> x', 'en').html;
    // ## = h2, ### = h3 (what the H2/H3 buttons say) and a body # is a section too: the h1 is the title.
    assert.match(html, /<h2 id="hola">Hola<\/h2>/);
    assert.match(html, /<h2 id="seccion">Sección<\/h2>/);
    assert.match(html, /<h3 id="sub">Sub<\/h3>/);
    assert.match(html, /“citas”/);
    assert.match(html, /Note/); // callout title in the post language
  });

  it('TeX math is MathML like on the page; the counter reads its TeX source; prices stay text', () => {
    const markdown = '($D = \\sigma^2/2$) y ($N_{\\text{ef}}$), cuesta $5 y $10\n\n```math\n\\mu\n```';
    const preview = renderPreview(markdown, 'es');
    assert.equal(preview.html, renderMarkdown(markdown, postBodyOptions('es')).html);
    assert.match(preview.html, /^<p><span class="math-nowrap">\(<math>.*<\/math>\)<\/span> y <span class="math-nowrap">\(<math><msub><mi>N<\/mi>/);
    assert.match(preview.html, /cuesta \$5 y \$10<\/p>\n<div class="math-display" tabindex="0"><math display="block"/);
    assert.equal(preview.text, '(D = \\sigma^2/2) y (N_{\\text{ef}}), cuesta $5 y $10 \\mu');
  });
});

/*
 * A single render per update: the counter and the outline read the preview result (`text`, `blockStarts`) instead of
 * parsing the Markdown again.
 */
describe('counter', () => {
  const stats = (markdown: string, lang: 'es' | 'en' = 'es') => documentStats(renderPreview(markdown, lang).text);

  it('words, characters of the read text and minutes with the site formula', () => {
    assert.deepEqual(stats('# Título\n\nUna **frase** [con](https://x.com) link.'), { words: 5, characters: 26, readingMinutes: 1 });
    assert.deepEqual(stats(''), { words: 0, characters: 0, readingMinutes: 1 });
    assert.equal(stats(Array(401).fill('palabra').join(' ')).readingMinutes, 3);
  });

  it('counts the plain text it receives, without parsing Markdown again', () => {
    assert.deepEqual(documentStats('**no** se parsea'), { words: 3, characters: 16, readingMinutes: 1 });
  });

  it('counts what the preview shows: site typography and callout titles in the post language', () => {
    assert.equal(stats('a... b').characters, 4); // "a… b"
    assert.deepEqual(stats('> [!NOTE]\n> hola', 'en'), { words: 2, characters: 9, readingMinutes: 1 }); // "Note hola"
  });
});

describe('heading outline', () => {
  it('each heading with its editor line; those in code and inside a quote (no anchor) do not count', () => {
    const markdown = '# Uno\n\ntexto\n\n```\n# no\n```\n\n## Dos\n> ### Cita\n\n### Tres';
    assert.deepEqual(outlineEntries(markdown, renderPreview(markdown, 'es')), [
      { id: 'uno', text: 'Uno', level: 2, line: 0 },
      { id: 'dos', text: 'Dos', level: 2, line: 8 },
      { id: 'tres', text: 'Tres', level: 3, line: 11 },
    ]);
  });

  it('if the counts do not match, no line (the outline only moves the preview)', () => {
    const headings = [{ id: 'x', text: 'x', level: 2 }, { id: 'y', text: 'y', level: 2 }];
    const entries = outlineEntries('    # sangrado', { headings, blockStarts: [0] });
    assert.deepEqual(entries.map((entry) => entry.line), [null, null]);
  });

  it('lineOffsets: where each requested line starts', () => {
    assert.deepEqual(lineOffsets('ab\ncd\n\nef', [0, 1, 3, 9]), [0, 3, 7, 9]);
  });
});

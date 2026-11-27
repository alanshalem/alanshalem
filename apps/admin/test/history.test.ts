import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostInput } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import { compareRevision, MAX_REVISIONS, restoreConfirmation } from '../src/posts/history.ts';
import { collapseUnchanged, diffLines, MAX_DIFF_CELLS, type DiffLine } from '../src/posts/lineDiff.ts';

/* Revision history: comparing a saved revision with what is being edited and restoring it. */

const same = (text: string): DiffLine => ({ kind: 'same', text });
const removed = (text: string): DiffLine => ({ kind: 'removed', text });
const added = (text: string): DiffLine => ({ kind: 'added', text });

describe('diffLines: line diff (LCS), from the revision to the current state', () => {
  it('equal texts: every line unchanged', () => {
    assert.deepEqual(diffLines('a\nb', 'a\nb'), [same('a'), same('b')]);
  });

  it('a changed line: the old one as removed and the new one as added, in that order', () => {
    assert.deepEqual(diffLines('a\nb\nc', 'a\nB\nc'), [same('a'), removed('b'), added('B'), same('c')]);
  });

  it('adding and removing at the start, in the middle and at the end', () => {
    assert.deepEqual(diffLines('b\nc', 'a\nb\nc\nd'), [added('a'), same('b'), same('c'), added('d')]);
    assert.deepEqual(diffLines('a\nb\nc', 'a\nc'), [same('a'), removed('b'), same('c')]);
  });

  it('keeps the longest common subsequence (does not over-mark)', () => {
    const result = diffLines('x\na\nb\nc\ny', 'a\nz\nb\nc');
    assert.deepEqual(result.filter((line) => line.kind === 'same').map((line) => line.text), ['a', 'b', 'c']);
    assert.deepEqual(result, [removed('x'), same('a'), added('z'), same('b'), same('c'), removed('y')]);
  });

  it('empty text = no lines (not one empty line)', () => {
    assert.deepEqual(diffLines('', ''), []);
    assert.deepEqual(diffLines('', 'a'), [added('a')]);
    assert.deepEqual(diffLines('a\nb', ''), [removed('a'), removed('b')]);
  });

  it('Windows line endings do not count as a change', () => {
    assert.deepEqual(diffLines('a\r\nb', 'a\nb'), [same('a'), same('b')]);
  });

  it('too large for the LCS table: the differing middle as a full replacement, prefix and suffix intact', () => {
    const size = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const before = ['start', ...Array.from({ length: size }, (_, i) => `v${i}`), 'end'].join('\n');
    const after = ['start', ...Array.from({ length: size }, (_, i) => `n${i}`), 'end'].join('\n');
    const result = diffLines(before, after);
    assert.deepEqual(result[0], same('start'));
    assert.deepEqual(result.at(-1), same('end'));
    assert.equal(result.filter((line) => line.kind === 'removed').length, size);
    assert.equal(result.filter((line) => line.kind === 'added').length, size);
    // Every removed line before the added ones.
    assert.equal(result.findIndex((line) => line.kind === 'added'), size + 1);
  });
});

describe('collapseUnchanged: only the changes and their context', () => {
  const lines = (text: string, other: string) => diffLines(text, other);
  const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);

  it('a change in the middle: 2 context lines on each side and the rest collapsed', () => {
    const changed = ten.map((line, i) => (i === 5 ? 'X' : line));
    assert.deepEqual(collapseUnchanged(lines(ten.join('\n'), changed.join('\n'))), [
      { kind: 'skipped', count: 3 },
      { kind: 'lines', lines: [same('l3'), same('l4'), removed('l5'), added('X'), same('l6'), same('l7')] },
      { kind: 'skipped', count: 2 },
    ]);
  });

  it('two nearby changes share a run; without changes a single summary is left', () => {
    const changed = ten.map((line, i) => (i === 1 || i === 4 ? line.toUpperCase() : line));
    const chunks = collapseUnchanged(lines(ten.join('\n'), changed.join('\n')));
    assert.equal(chunks.filter((chunk) => chunk.kind === 'lines').length, 1);
    assert.deepEqual(chunks.at(-1), { kind: 'skipped', count: 3 });
    assert.deepEqual(collapseUnchanged(lines('a\nb', 'a\nb')), [{ kind: 'skipped', count: 2 }]);
    assert.deepEqual(collapseUnchanged([]), []);
  });

  it('the context can be chosen', () => {
    assert.deepEqual(collapseUnchanged(lines('a\nb\nc', 'a\nB\nc'), 0), [
      { kind: 'skipped', count: 1 },
      { kind: 'lines', lines: [removed('b'), added('B')] },
      { kind: 'skipped', count: 1 },
    ]);
  });
});

describe('compareRevision: what changes between a revision and what is being edited', () => {
  const content: PostInput = {
    title: 'Hola',
    slug: 'hola',
    summary: 'Resumen',
    body: 'uno\ndos',
    tags: ['a', 'b'],
    coverUrl: null,
    coverAlt: null,
  };

  it('equal: no field or text changes', () => {
    const result = compareRevision(content, { ...content });
    assert.equal(result.identical, true);
    assert.deepEqual(result.fields, []);
  });

  it('edge spaces and an empty cover versus null are not changes (the same the save normalizes)', () => {
    const result = compareRevision(content, { ...content, title: ' Hola ', coverUrl: '', coverAlt: '' });
    assert.equal(result.identical, true);
  });

  it('each differing field with its before and after value; tags as a list', () => {
    const result = compareRevision(content, {
      ...content,
      title: 'Chau',
      tags: ['a', 'c'],
      coverUrl: '/media/x.webp',
      body: 'uno\ntres',
    });
    assert.equal(result.identical, false);
    assert.deepEqual(result.fields, [
      { field: 'title', before: 'Hola', after: 'Chau' },
      { field: 'tags', before: 'a, b', after: 'a, c' },
      { field: 'coverUrl', before: '', after: '/media/x.webp' },
    ]);
    assert.deepEqual(result.body, [{ kind: 'lines', lines: [same('uno'), removed('dos'), added('tres')] }]);
  });

  it('only the text changes: no field changes but not equal', () => {
    const result = compareRevision(content, { ...content, body: 'uno' });
    assert.equal(result.identical, false);
    assert.deepEqual(result.fields, []);
  });
});

describe('restoreConfirmation: warns if unsaved changes are lost (like the leave guard)', () => {
  it('without changes: what is saved stays in the history', () => {
    assert.equal(
      restoreConfirmation(3, false, i18nFor('es').t),
      '¿Restaurar la versión 3? Lo que está guardado ahora queda en el historial.',
    );
    assert.equal(restoreConfirmation(3, false, i18nFor('en').t), 'Restore version 3? What’s saved now stays in the history.');
  });

  it('with unsaved changes: warns they are replaced', () => {
    assert.equal(
      restoreConfirmation(2, true, i18nFor('es').t),
      '¿Restaurar la versión 2? Reemplaza los cambios sin guardar: se van a perder.',
    );
    assert.equal(
      restoreConfirmation(2, true, i18nFor('en').t),
      'Restore version 2? It replaces your unsaved changes: they’ll be lost.',
    );
  });

  it('the revision limit is the API one (PostRevision.MaxPerPost)', () => {
    assert.equal(MAX_REVISIONS, 50);
  });
});

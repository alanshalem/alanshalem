import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findMatches,
  nearestOccurrence,
  replaceAllEdit,
  replaceMatchEdit,
  stepMatch,
  type SearchOptions,
} from '../src/editor/search.ts';
import { applyEditToState, spliceKeepingSelection } from '../src/editor/text.ts';

/* Find/replace: pure functions; the panel only connects them to the textarea. */

const PLAIN: SearchOptions = { caseSensitive: false, wholeWord: false };
const ranges = (text: string, query: string, options: Partial<SearchOptions> = {}): Array<[number, number]> =>
  findMatches(text, query, { ...PLAIN, ...options }).map(({ from, to }) => [from, to]);

describe('findMatches', () => {
  it('case-insensitive by default; case-sensitive on request', () => {
    assert.deepEqual(ranges('Hola hola HOLA', 'hola'), [[0, 4], [5, 9], [10, 14]]);
    assert.deepEqual(ranges('Hola hola HOLA', 'hola', { caseSensitive: true }), [[5, 9]]);
  });

  it('whole word, also with accented letters and ñ', () => {
    assert.deepEqual(ranges('sol solo sol, girasol', 'sol', { wholeWord: true }), [[0, 3], [9, 12]]);
    assert.deepEqual(ranges('año añoso', 'año', { wholeWord: true }), [[0, 3]]);
  });

  it('the searched text is literal (no regular expressions)', () => {
    assert.deepEqual(ranges('a.b axb (x) a.b', 'a.b'), [[0, 3], [12, 15]]);
    assert.deepEqual(ranges('f(x) [y] $z', '(x)'), [[1, 4]]);
  });

  it('empty search: no matches', () => {
    assert.deepEqual(ranges('abc', ''), []);
  });
});

describe('stepMatch: next / previous, wrapping around', () => {
  const matches = [{ from: 0, to: 2 }, { from: 10, to: 12 }, { from: 20, to: 22 }];

  it('from the caret, the next one is the first that starts at or after it', () => {
    assert.equal(stepMatch(matches, { start: 5, end: 5 }, 1), 1);
    assert.equal(stepMatch(matches, { start: 10, end: 10 }, 1), 1);
  });

  it('with a match selected, it moves to the next one', () => {
    assert.equal(stepMatch(matches, { start: 10, end: 12 }, 1), 2);
    assert.equal(stepMatch(matches, { start: 20, end: 22 }, 1), 0, 'after the last one it goes back to the first');
  });

  it('previous: the last one starting before; from the first, the last', () => {
    assert.equal(stepMatch(matches, { start: 5, end: 5 }, -1), 0);
    assert.equal(stepMatch(matches, { start: 0, end: 2 }, -1), 2);
  });

  it('no matches: -1', () => {
    assert.equal(stepMatch([], { start: 0, end: 0 }, 1), -1);
  });
});

describe('replace', () => {
  const state = (value: string) => ({ value, start: 0, end: 0 });

  it('replace all is ONE edit (a single undo) and the replacement is literal', () => {
    const value = 'a x a x b';
    const edit = replaceAllEdit(value, findMatches(value, 'x', PLAIN), '$&');
    assert.ok(edit);
    assert.deepEqual([edit.from, edit.to], [2, 7], 'spans from the first to the last match');
    assert.equal(applyEditToState(state(value), edit).value, 'a $& a $& b');
  });

  it('without matches there is no edit', () => {
    assert.equal(replaceAllEdit('abc', [], 'z'), null);
  });

  it('replacing one leaves the replacement selected', () => {
    const after = applyEditToState(state('a x b'), replaceMatchEdit({ from: 2, to: 3 }, 'yy'));
    assert.deepEqual(after, { value: 'a yy b', start: 2, end: 4 });
  });
});

describe('image upload marker', () => {
  it('nearestOccurrence picks the occurrence closest to where it was inserted', () => {
    assert.equal(nearestOccurrence('P x P y', 'P', 5), 4);
    assert.equal(nearestOccurrence('P x P y', 'P', 1), 0);
    assert.equal(nearestOccurrence('abc', 'P', 1), -1);
  });

  it('spliceKeepingSelection replaces a range without moving what the user has selected', () => {
    const value = 'start [P] finish';
    const keep = (start: number, end: number) => applyEditToState({ value, start, end }, spliceKeepingSelection({ value, start, end }, 6, 9, '![a](u)'));
    assert.deepEqual(keep(2, 4), { value: 'start ![a](u) finish', start: 2, end: 4 }, 'before the range: unchanged');
    assert.deepEqual(keep(11, 13), { value: 'start ![a](u) finish', start: 15, end: 17 }, 'after: it shifts');
    assert.deepEqual(keep(7, 7), { value: 'start ![a](u) finish', start: 13, end: 13 }, 'inside: at the end of the replacement');
  });
});

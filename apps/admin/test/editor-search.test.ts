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

/* Buscar/reemplazar (S2): funciones puras; el panel solo las conecta con el textarea. */

const PLAIN: SearchOptions = { caseSensitive: false, wholeWord: false };
const ranges = (text: string, query: string, options: Partial<SearchOptions> = {}): Array<[number, number]> =>
  findMatches(text, query, { ...PLAIN, ...options }).map(({ from, to }) => [from, to]);

describe('findMatches', () => {
  it('sin distinguir mayúsculas por defecto; distinguiendo si se pide', () => {
    assert.deepEqual(ranges('Hola hola HOLA', 'hola'), [[0, 4], [5, 9], [10, 14]]);
    assert.deepEqual(ranges('Hola hola HOLA', 'hola', { caseSensitive: true }), [[5, 9]]);
  });

  it('palabra completa, también con letras acentuadas y ñ', () => {
    assert.deepEqual(ranges('sol solo sol, girasol', 'sol', { wholeWord: true }), [[0, 3], [9, 12]]);
    assert.deepEqual(ranges('año añoso', 'año', { wholeWord: true }), [[0, 3]]);
  });

  it('el texto buscado es literal (sin expresiones regulares)', () => {
    assert.deepEqual(ranges('a.b axb (x) a.b', 'a.b'), [[0, 3], [12, 15]]);
    assert.deepEqual(ranges('f(x) [y] $z', '(x)'), [[1, 4]]);
  });

  it('búsqueda vacía: ninguna coincidencia', () => {
    assert.deepEqual(ranges('abc', ''), []);
  });
});

describe('stepMatch: siguiente / anterior con vuelta al principio', () => {
  const matches = [{ from: 0, to: 2 }, { from: 10, to: 12 }, { from: 20, to: 22 }];

  it('desde el cursor, la siguiente es la primera que empieza en o después', () => {
    assert.equal(stepMatch(matches, { start: 5, end: 5 }, 1), 1);
    assert.equal(stepMatch(matches, { start: 10, end: 10 }, 1), 1);
  });

  it('con una coincidencia seleccionada, avanza a la otra', () => {
    assert.equal(stepMatch(matches, { start: 10, end: 12 }, 1), 2);
    assert.equal(stepMatch(matches, { start: 20, end: 22 }, 1), 0, 'después de la última vuelve a la primera');
  });

  it('anterior: la última que empieza antes; desde la primera, la última', () => {
    assert.equal(stepMatch(matches, { start: 5, end: 5 }, -1), 0);
    assert.equal(stepMatch(matches, { start: 0, end: 2 }, -1), 2);
  });

  it('sin coincidencias: -1', () => {
    assert.equal(stepMatch([], { start: 0, end: 0 }, 1), -1);
  });
});

describe('reemplazar', () => {
  const state = (value: string) => ({ value, start: 0, end: 0 });

  it('reemplazar todo es UNA sola edición (un solo deshacer) y el reemplazo es literal', () => {
    const value = 'a x a x b';
    const edit = replaceAllEdit(value, findMatches(value, 'x', PLAIN), '$&');
    assert.ok(edit);
    assert.deepEqual([edit.from, edit.to], [2, 7], 'abarca de la primera a la última coincidencia');
    assert.equal(applyEditToState(state(value), edit).value, 'a $& a $& b');
  });

  it('sin coincidencias no hay edición', () => {
    assert.equal(replaceAllEdit('abc', [], 'z'), null);
  });

  it('reemplazar una deja seleccionado el reemplazo', () => {
    const after = applyEditToState(state('a x b'), replaceMatchEdit({ from: 2, to: 3 }, 'yy'));
    assert.deepEqual(after, { value: 'a yy b', start: 2, end: 4 });
  });
});

describe('marcador de subida de imagen', () => {
  it('nearestOccurrence elige la aparición más cercana a donde se insertó', () => {
    assert.equal(nearestOccurrence('P x P y', 'P', 5), 4);
    assert.equal(nearestOccurrence('P x P y', 'P', 1), 0);
    assert.equal(nearestOccurrence('abc', 'P', 1), -1);
  });

  it('spliceKeepingSelection reemplaza un rango sin mover lo que el usuario tiene seleccionado', () => {
    const value = 'antes [P] después';
    const keep = (start: number, end: number) => applyEditToState({ value, start, end }, spliceKeepingSelection({ value, start, end }, 6, 9, '![a](u)'));
    assert.deepEqual(keep(2, 4), { value: 'antes ![a](u) después', start: 2, end: 4 }, 'antes del rango: igual');
    assert.deepEqual(keep(11, 13), { value: 'antes ![a](u) después', start: 15, end: 17 }, 'después: se corre');
    assert.deepEqual(keep(7, 7), { value: 'antes ![a](u) después', start: 13, end: 13 }, 'adentro: al final del reemplazo');
  });
});

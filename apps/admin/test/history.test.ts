import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostInput } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import { compareRevision, MAX_REVISIONS, restoreConfirmation } from '../src/posts/history.ts';
import { collapseUnchanged, diffLines, MAX_DIFF_CELLS, type DiffLine } from '../src/posts/lineDiff.ts';

/* Historial de versiones (S5, E5): comparar una versión guardada con lo que se está editando y restaurarla. */

const same = (text: string): DiffLine => ({ kind: 'same', text });
const removed = (text: string): DiffLine => ({ kind: 'removed', text });
const added = (text: string): DiffLine => ({ kind: 'added', text });

describe('diffLines: diff por líneas (LCS), de la versión a lo actual', () => {
  it('textos iguales: todas las líneas sin cambios', () => {
    assert.deepEqual(diffLines('a\nb', 'a\nb'), [same('a'), same('b')]);
  });

  it('una línea cambiada: la vieja como quitada y la nueva como agregada, en ese orden', () => {
    assert.deepEqual(diffLines('a\nb\nc', 'a\nB\nc'), [same('a'), removed('b'), added('B'), same('c')]);
  });

  it('agregar y quitar al principio, en el medio y al final', () => {
    assert.deepEqual(diffLines('b\nc', 'a\nb\nc\nd'), [added('a'), same('b'), same('c'), added('d')]);
    assert.deepEqual(diffLines('a\nb\nc', 'a\nc'), [same('a'), removed('b'), same('c')]);
  });

  it('conserva la subsecuencia común más larga (no marca de más)', () => {
    const result = diffLines('x\na\nb\nc\ny', 'a\nz\nb\nc');
    assert.deepEqual(result.filter((line) => line.kind === 'same').map((line) => line.text), ['a', 'b', 'c']);
    assert.deepEqual(result, [removed('x'), same('a'), added('z'), same('b'), same('c'), removed('y')]);
  });

  it('texto vacío = sin líneas (no una línea vacía)', () => {
    assert.deepEqual(diffLines('', ''), []);
    assert.deepEqual(diffLines('', 'a'), [added('a')]);
    assert.deepEqual(diffLines('a\nb', ''), [removed('a'), removed('b')]);
  });

  it('los finales de línea de Windows no cuentan como cambio', () => {
    assert.deepEqual(diffLines('a\r\nb', 'a\nb'), [same('a'), same('b')]);
  });

  it('demasiado grande para la tabla LCS: el medio distinto como reemplazo completo, prefijo y sufijo intactos', () => {
    const size = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const before = ['inicio', ...Array.from({ length: size }, (_, i) => `v${i}`), 'fin'].join('\n');
    const after = ['inicio', ...Array.from({ length: size }, (_, i) => `n${i}`), 'fin'].join('\n');
    const result = diffLines(before, after);
    assert.deepEqual(result[0], same('inicio'));
    assert.deepEqual(result.at(-1), same('fin'));
    assert.equal(result.filter((line) => line.kind === 'removed').length, size);
    assert.equal(result.filter((line) => line.kind === 'added').length, size);
    // Todas las quitadas antes que las agregadas.
    assert.equal(result.findIndex((line) => line.kind === 'added'), size + 1);
  });
});

describe('collapseUnchanged: solo los cambios y su contexto', () => {
  const lines = (text: string, other: string) => diffLines(text, other);
  const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);

  it('un cambio en el medio: 2 líneas de contexto a cada lado y lo demás resumido', () => {
    const changed = ten.map((line, i) => (i === 5 ? 'X' : line));
    assert.deepEqual(collapseUnchanged(lines(ten.join('\n'), changed.join('\n'))), [
      { kind: 'skipped', count: 3 },
      { kind: 'lines', lines: [same('l3'), same('l4'), removed('l5'), added('X'), same('l6'), same('l7')] },
      { kind: 'skipped', count: 2 },
    ]);
  });

  it('dos cambios cercanos comparten un tramo; sin cambios queda un solo resumen', () => {
    const changed = ten.map((line, i) => (i === 1 || i === 4 ? line.toUpperCase() : line));
    const chunks = collapseUnchanged(lines(ten.join('\n'), changed.join('\n')));
    assert.equal(chunks.filter((chunk) => chunk.kind === 'lines').length, 1);
    assert.deepEqual(chunks.at(-1), { kind: 'skipped', count: 3 });
    assert.deepEqual(collapseUnchanged(lines('a\nb', 'a\nb')), [{ kind: 'skipped', count: 2 }]);
    assert.deepEqual(collapseUnchanged([]), []);
  });

  it('el contexto se puede elegir', () => {
    assert.deepEqual(collapseUnchanged(lines('a\nb\nc', 'a\nB\nc'), 0), [
      { kind: 'skipped', count: 1 },
      { kind: 'lines', lines: [removed('b'), added('B')] },
      { kind: 'skipped', count: 1 },
    ]);
  });
});

describe('compareRevision: qué cambia entre una versión y lo que se está editando', () => {
  const content: PostInput = {
    title: 'Hola',
    slug: 'hola',
    summary: 'Resumen',
    body: 'uno\ndos',
    tags: ['a', 'b'],
    coverUrl: null,
    coverAlt: null,
  };

  it('igual: sin cambios de campos ni de texto', () => {
    const result = compareRevision(content, { ...content });
    assert.equal(result.identical, true);
    assert.deepEqual(result.fields, []);
  });

  it('espacios de los bordes y portada vacía contra null no son cambios (lo mismo que normaliza el guardado)', () => {
    const result = compareRevision(content, { ...content, title: ' Hola ', coverUrl: '', coverAlt: '' });
    assert.equal(result.identical, true);
  });

  it('cada campo distinto con su valor de antes y de ahora; las etiquetas como lista', () => {
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

  it('solo cambia el texto: sin cambios de campos pero no es igual', () => {
    const result = compareRevision(content, { ...content, body: 'uno' });
    assert.equal(result.identical, false);
    assert.deepEqual(result.fields, []);
  });
});

describe('restoreConfirmation: avisa si se pierden cambios sin guardar (como el guardia de salida)', () => {
  it('sin cambios: lo guardado queda en el historial', () => {
    assert.equal(
      restoreConfirmation(3, false, i18nFor('es').t),
      '¿Restaurar la versión 3? Lo que está guardado ahora queda en el historial.',
    );
    assert.equal(restoreConfirmation(3, false, i18nFor('en').t), 'Restore version 3? What’s saved now stays in the history.');
  });

  it('con cambios sin guardar: avisa que se reemplazan', () => {
    assert.equal(
      restoreConfirmation(2, true, i18nFor('es').t),
      '¿Restaurar la versión 2? Reemplaza los cambios sin guardar: se van a perder.',
    );
    assert.equal(
      restoreConfirmation(2, true, i18nFor('en').t),
      'Restore version 2? It replaces your unsaved changes: they’ll be lost.',
    );
  });

  it('el límite de versiones es el de la API (PostRevision.MaxPerPost)', () => {
    assert.equal(MAX_REVISIONS, 50);
  });
});

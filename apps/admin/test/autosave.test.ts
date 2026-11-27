import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '../src/i18n/i18n.ts';
import { AUTOSAVE_DELAY_MS, canAutosave, saveStatusText, type SaveState } from '../src/posts/autosave.ts';

/*
 * Autosave: only drafts that already exist. A published post is saved by hand because saving it rebuilds the site;
 * a new one too (creating it fixes its language, which is chosen before the first save).
 */

const draft = { exists: true, published: false, title: 'T', dirty: true, saving: false };

describe('canAutosave', () => {
  it('an existing draft with changes, a title and no other save in progress', () => {
    assert.equal(canAutosave(draft), true);
    assert.equal(AUTOSAVE_DELAY_MS, 3000);
  });

  it('never: published, new, unchanged, untitled or with a save in progress (no overlapping requests)', () => {
    for (const change of [{ published: true }, { exists: false }, { dirty: false }, { title: '  ' }, { saving: true }]) {
      assert.equal(canAutosave({ ...draft, ...change }), false, JSON.stringify(change));
    }
  });
});

describe('saveStatusText', () => {
  const es = i18nFor('es');
  const at = new Date(2026, 10, 25, 14, 5);
  const status = (state: SaveState, extra: Partial<{ dirty: boolean; exists: boolean; published: boolean }> = {}) =>
    saveStatusText({ state, dirty: false, exists: true, published: false, ...extra }, es);

  it('Guardando… / Guardado hh:mm / error', () => {
    assert.equal(status({ kind: 'saving' }, { dirty: true }), 'Guardando…');
    assert.equal(status({ kind: 'saved', at }), 'Guardado 14:05');
    assert.equal(status({ kind: 'error' }, { dirty: true }), 'No se pudo guardar');
  });

  it('unsaved changes: on a published post, it says it is saved by hand', () => {
    assert.equal(status({ kind: 'saved', at }, { dirty: true }), 'Cambios sin guardar');
    assert.equal(status({ kind: 'idle' }, { dirty: true, published: true }), 'Cambios sin guardar · publicado: se guarda a mano');
  });

  it('no changes and no saves this visit: as before', () => {
    assert.equal(status({ kind: 'idle' }), 'Todo guardado');
    assert.equal(status({ kind: 'idle' }, { exists: false }), '');
  });

  it('in English, with the language time format', () => {
    assert.match(saveStatusText({ state: { kind: 'saved', at }, dirty: false, exists: true, published: false }, i18nFor('en')), /^Saved 2:05\sPM$/u);
  });
});

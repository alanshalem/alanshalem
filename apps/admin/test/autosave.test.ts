import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '../src/i18n/i18n.ts';
import { AUTOSAVE_DELAY_MS, canAutosave, saveStatusText, type SaveState } from '../src/posts/autosave.ts';

/*
 * Guardado automático (S3): solo borradores ya creados. Un post publicado se guarda a mano porque guardarlo regenera
 * el sitio; uno nuevo, también (crearlo fija su idioma, que se elige antes del primer guardado).
 */

const draft = { exists: true, published: false, title: 'T', dirty: true, saving: false };

describe('canAutosave', () => {
  it('un borrador existente con cambios, título y sin otro guardado en curso', () => {
    assert.equal(canAutosave(draft), true);
    assert.equal(AUTOSAVE_DELAY_MS, 3000);
  });

  it('nunca: publicado, nuevo, sin cambios, sin título o con un guardado en curso (sin pedidos superpuestos)', () => {
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

  it('cambios sin guardar: en un publicado, avisa que se guarda a mano', () => {
    assert.equal(status({ kind: 'saved', at }, { dirty: true }), 'Cambios sin guardar');
    assert.equal(status({ kind: 'idle' }, { dirty: true, published: true }), 'Cambios sin guardar · publicado: se guarda a mano');
  });

  it('sin cambios ni guardados en esta visita: como antes', () => {
    assert.equal(status({ kind: 'idle' }), 'Todo guardado');
    assert.equal(status({ kind: 'idle' }, { exists: false }), '');
  });

  it('en inglés, con la hora del idioma', () => {
    assert.match(saveStatusText({ state: { kind: 'saved', at }, dirty: false, exists: true, published: false }, i18nFor('en')), /^Saved 2:05\sPM$/u);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesChord, SAVE_CHORD, type KeyLike } from '../src/editor/shortcuts.ts';
import { leaveConfirmation, type LeaveGuard } from '../src/navigation/leaveGuard.ts';

/*
 * Cambios sin guardar (plataforma-calidad U3, P1-5): una sola regla decide si hay que preguntar antes de salir de una
 * vista (otra ruta, "← Posts", Salir, "Crear versión"). El guardado automático deja el formulario limpio (`dirty`
 * falso), así que un borrador ya guardado solo no pregunta.
 */

const dirty: LeaveGuard = { dirty: true, message: '¿Salir sin guardar?' };
const clean: LeaveGuard = { dirty: false, message: 'no debería verse' };

describe('leaveConfirmation: preguntar solo si se pierde algo', () => {
  it('sin formularios abiertos, o todos guardados, se sale sin preguntar', () => {
    assert.equal(leaveConfirmation([], { name: 'settings' }, { name: 'posts' }), null);
    assert.equal(leaveConfirmation([clean], { name: 'edit', id: 'a' }, { name: 'posts' }), null);
  });

  it('con cambios, ir a otra ruta pregunta (el texto del formulario con cambios)', () => {
    assert.equal(leaveConfirmation([clean, dirty], { name: 'edit', id: 'a' }, { name: 'posts' }), dirty.message);
    assert.equal(leaveConfirmation([dirty], { name: 'edit', id: 'a' }, { name: 'edit', id: 'b' }), dirty.message);
  });

  it('con cambios, salir del admin o abrir una versión nueva (destino null) también pregunta', () => {
    assert.equal(leaveConfirmation([dirty], { name: 'settings' }, null), dirty.message);
  });

  it('un enlace a la misma vista no la cambia: no pregunta', () => {
    assert.equal(leaveConfirmation([dirty], { name: 'settings' }, { name: 'settings' }), null);
    assert.equal(leaveConfirmation([dirty], { name: 'edit', id: 'a' }, { name: 'edit', id: 'a' }), null);
  });
});

describe('Ctrl/Cmd+S: un solo atajo de guardado para el editor y los ajustes', () => {
  const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
    key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
  });

  it('Ctrl+S y Cmd+S (también con Bloq Mayús)', () => {
    assert.equal(matchesChord(key('s', { ctrlKey: true }), SAVE_CHORD), true);
    assert.equal(matchesChord(key('s', { metaKey: true }), SAVE_CHORD), true);
    assert.equal(matchesChord(key('S', { ctrlKey: true }), SAVE_CHORD), true);
  });

  it('una "s" sola o con AltGr no guarda', () => {
    assert.equal(matchesChord(key('s'), SAVE_CHORD), false);
    assert.equal(matchesChord(key('s', { ctrlKey: true, altKey: true }), SAVE_CHORD), false);
  });
});

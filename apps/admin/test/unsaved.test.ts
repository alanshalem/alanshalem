import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesChord, SAVE_CHORD, type KeyLike } from '../src/editor/shortcuts.ts';
import { leaveConfirmation, type LeaveGuard } from '../src/navigation/leaveGuard.ts';

/*
 * Unsaved changes: one rule decides whether to ask before leaving a view (another route, "← Posts", Salir,
 * "Crear versión"). Autosave leaves the form clean (`dirty` false), so a draft that already saved itself does not
 * ask.
 */

const dirty: LeaveGuard = { dirty: true, message: 'Leave without saving?' };
const clean: LeaveGuard = { dirty: false, message: 'should not show' };

describe('leaveConfirmation: ask only if something would be lost', () => {
  it('without open forms, or all saved, it leaves without asking', () => {
    assert.equal(leaveConfirmation([], { name: 'settings' }, { name: 'posts' }), null);
    assert.equal(leaveConfirmation([clean], { name: 'edit', id: 'a' }, { name: 'posts' }), null);
  });

  it('with changes, going to another route asks (the text of the form with changes)', () => {
    assert.equal(leaveConfirmation([clean, dirty], { name: 'edit', id: 'a' }, { name: 'posts' }), dirty.message);
    assert.equal(leaveConfirmation([dirty], { name: 'edit', id: 'a' }, { name: 'edit', id: 'b' }), dirty.message);
  });

  it('with changes, leaving the admin or opening a new version (null target) asks too', () => {
    assert.equal(leaveConfirmation([dirty], { name: 'settings' }, null), dirty.message);
  });

  it('a link to the same view does not change it: no question', () => {
    assert.equal(leaveConfirmation([dirty], { name: 'settings' }, { name: 'settings' }), null);
    assert.equal(leaveConfirmation([dirty], { name: 'edit', id: 'a' }, { name: 'edit', id: 'a' }), null);
  });
});

describe('Ctrl/Cmd+S: one save shortcut for the editor and the settings', () => {
  const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
    key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
  });

  it('Ctrl+S and Cmd+S (also with Caps Lock)', () => {
    assert.equal(matchesChord(key('s', { ctrlKey: true }), SAVE_CHORD), true);
    assert.equal(matchesChord(key('s', { metaKey: true }), SAVE_CHORD), true);
    assert.equal(matchesChord(key('S', { ctrlKey: true }), SAVE_CHORD), true);
  });

  it('a bare "s" or with AltGr does not save', () => {
    assert.equal(matchesChord(key('s'), SAVE_CHORD), false);
    assert.equal(matchesChord(key('s', { ctrlKey: true, altKey: true }), SAVE_CHORD), false);
  });
});

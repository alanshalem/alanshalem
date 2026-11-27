import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { editorActions, inPalette, type EditorAction } from '../src/editor/actions.ts';
import { insertLink, insertTable, uploadPlaceholder } from '../src/editor/commands.ts';
import { fuzzyFilter, fuzzyScore } from '../src/editor/fuzzy.ts';
import { actionForKey, commandForKey, formatChord, type KeyLike } from '../src/editor/shortcuts.ts';
import { applyEditToState } from '../src/editor/text.ts';
import { DEFAULT_VIEW_PREFS, loadViewPrefs, nextView, saveViewPrefs, VIEW_STORAGE_KEY } from '../src/editor/view.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

/* One action registry feeds the toolbar, the palette, the shortcuts and the help. */

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
});
const ids = (actions: readonly EditorAction[]): string[] => actions.map((action) => action.id);

describe('action registry', () => {
  const actions = editorActions('es');

  it('unique ids and shortcuts', () => {
    assert.equal(new Set(ids(actions)).size, actions.length);
    const chords = actions.flatMap((action) => (action.chord ? [formatChord(action.chord, false)] : []));
    assert.equal(new Set(chords).size, chords.length, chords.join(' '));
  });

  it('the toolbar has every previous formatting command, in the same order, plus the site Markdown, views, original, focus, palette and help', () => {
    assert.deepEqual(ids(actions.filter((action) => action.toolbar)), [
      'bold', 'italic', 'strike', 'code', 'heading', 'subheading', 'bulletList', 'numberedList', 'quote',
      'link', 'codeBlock', 'table', 'rule', 'image', 'figure', 'footnote', 'callout.note',
      'view.editor', 'view.split', 'view.preview', 'compare', 'focus', 'palette', 'help',
    ]);
  });

  it('the palette lists every action except the typing ones (Enter, Tab, Esc, paste as plain text)', () => {
    const palette = ids(actions.filter(inPalette));
    for (const id of ['bold', 'rule', 'image', 'view.cycle', 'focus', 'find', 'replace', 'help']) assert.ok(palette.includes(id), id);
    for (const id of ['continueList', 'indent', 'outdent', 'plainPaste', 'dismiss', 'palette']) assert.ok(!palette.includes(id), id);
  });

  it('the requested shortcuts: Ctrl+F, Ctrl+H, Ctrl+P, Ctrl+K, Ctrl+/, Ctrl+Shift+V', () => {
    const chordOf = (id: string) => actions.find((action) => action.id === id)?.chord;
    assert.deepEqual(
      ['find', 'replace', 'palette', 'link', 'help', 'plainPaste'].map((id) => formatChord(chordOf(id)!, false)),
      ['Ctrl+F', 'Ctrl+H', 'Ctrl+P', 'Ctrl+K', 'Ctrl+/', 'Ctrl+Shift+V'],
    );
  });

  // The H2/H3 buttons write what they say (## = h2, ### = h3 on the site and in the preview).
  it('H2 writes "## " and H3 "### "', () => {
    const run = (id: string): string => {
      const action = actions.find((candidate) => candidate.id === id)!;
      assert.ok('edit' in action.run);
      const edit = action.run.edit({ value: 'Idea', start: 0, end: 0 })!;
      return applyEditToState({ value: 'Idea', start: 0, end: 0 }, edit).value;
    };
    assert.equal(run('heading'), '## Idea');
    assert.equal(run('subheading'), '### Idea');
  });

  it('one instance per language (stable as a hook dependency)', () => {
    assert.equal(editorActions('en'), editorActions('en'));
  });
});

describe('shortcuts', () => {
  const actions = editorActions('es');

  it('Ctrl or Cmd; Ctrl+/ works even if the keyboard needs Shift for the slash (Spanish layout)', () => {
    assert.equal(actionForKey(key('f', { metaKey: true }), actions)?.id, 'find');
    assert.equal(actionForKey(key('/', { ctrlKey: true, shiftKey: true }), actions)?.id, 'help');
    assert.equal(actionForKey(key('Escape'), actions)?.id, 'dismiss');
  });

  it('AltGr (Ctrl+Alt on Windows) never triggers a shortcut: it types @, #, |…', () => {
    assert.equal(actionForKey(key('2', { ctrlKey: true, altKey: true }), actions), undefined);
    assert.equal(actionForKey(key('f', { ctrlKey: true, altKey: true }), actions), undefined);
  });

  it('formatChord: Ctrl+… on Windows/Linux; symbols on Mac', () => {
    const strike = actions.find((action) => action.id === 'strike')!.chord!;
    assert.equal(formatChord(strike, false), 'Ctrl+Shift+X');
    assert.equal(formatChord(strike, true), '⌘⇧X');
    assert.equal(formatChord({ key: 'Escape' }, false), 'Esc');
  });

  it('commandForKey uses the placeholder texts of the post language', () => {
    const command = commandForKey(key('k', { ctrlKey: true }), 'en');
    assert.ok(command);
    const edit = command({ value: '', start: 0, end: 0 });
    assert.ok(edit);
    assert.deepEqual(applyEditToState({ value: '', start: 0, end: 0 }, edit), { value: '[text](url)', start: 1, end: 5 });
  });
});

describe('placeholder texts in the POST language, not the UI language', () => {
  const run = (command: (typeof insertTable)['en'], value = '') => {
    const edit = command({ value, start: 0, end: 0 });
    assert.ok(edit);
    const state = applyEditToState({ value, start: 0, end: 0 }, edit);
    return `${state.value.slice(0, state.start)}«${state.value.slice(state.start, state.end)}»${state.value.slice(state.end)}`;
  };

  it('link and table in English', () => {
    assert.equal(run(insertLink.en), '[«text»](url)');
    assert.equal(run(insertTable.en), '| «Column» | Column |\n| --- | --- |\n| Value | Value |');
  });

  it('the upload marker', () => {
    assert.equal(uploadPlaceholder('es'), '![Subiendo…]()');
    assert.equal(uploadPlaceholder('en'), '![Uploading…]()');
  });
});

describe('fuzzy', () => {
  it('subsequence ignoring accents and case; no match, null', () => {
    assert.notEqual(fuzzyScore('titulo', 'Título'), null);
    assert.notEqual(fuzzyScore('lnum', 'Lista numerada'), null);
    assert.equal(fuzzyScore('xyz', 'Negrita'), null);
  });

  it('prefers consecutive letters and word starts; empty query = everything, in order', () => {
    const labels = ['Línea horizontal', 'Lista con viñetas', 'Negrita', 'Link'];
    assert.deepEqual(fuzzyFilter(labels, 'lin', (label) => label), ['Línea horizontal', 'Link', 'Lista con viñetas']);
    assert.deepEqual(fuzzyFilter(labels, 'neg', (label) => label), ['Negrita']);
    assert.deepEqual(fuzzyFilter(labels, '', (label) => label), labels);
  });

  it('searches the translated palette texts', () => {
    const { t } = i18nFor('en');
    const found = fuzzyFilter(editorActions('en').filter(inPalette), 'repl', (action) => t(action.label));
    assert.equal(found[0]?.id, 'replace');
  });
});

describe('editor view: persisted', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('split and without focus mode by default; the stored value is honored', () => {
    assert.deepEqual(loadViewPrefs(storage()), DEFAULT_VIEW_PREFS);
    assert.deepEqual(DEFAULT_VIEW_PREFS, { view: 'split', focus: false });
    const store = storage();
    saveViewPrefs(store, { view: 'preview', focus: true });
    assert.deepEqual(loadViewPrefs(store), { view: 'preview', focus: true });
  });

  it('invalid stored values or blocked storage: the default, without errors', () => {
    assert.deepEqual(loadViewPrefs(storage({ [VIEW_STORAGE_KEY]: '{"view":"x","focus":1}' })), DEFAULT_VIEW_PREFS);
    assert.deepEqual(loadViewPrefs(storage({ [VIEW_STORAGE_KEY]: 'no-json' })), DEFAULT_VIEW_PREFS);
    const broken = { getItem: (): string | null => { throw new Error('x'); }, setItem: (): void => { throw new Error('x'); } };
    assert.deepEqual(loadViewPrefs(broken), DEFAULT_VIEW_PREFS);
    assert.doesNotThrow(() => saveViewPrefs(broken, DEFAULT_VIEW_PREFS));
  });

  it('the view shortcut cycles editor → split → preview → editor', () => {
    assert.deepEqual([nextView('editor'), nextView('split'), nextView('preview')], ['split', 'preview', 'editor']);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { editorActions, inPalette, type EditorAction } from '../src/editor/actions.ts';
import { insertLink, insertTable, uploadPlaceholder } from '../src/editor/commands.ts';
import { fuzzyFilter, fuzzyScore } from '../src/editor/fuzzy.ts';
import { actionForKey, commandForKey, formatChord, type KeyLike } from '../src/editor/shortcuts.ts';
import { applyEditToState } from '../src/editor/text.ts';
import { DEFAULT_VIEW_PREFS, loadViewPrefs, nextView, saveViewPrefs, VIEW_STORAGE_KEY } from '../src/editor/view.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

/* Un solo registro de acciones (S2, S7) alimenta la barra, la paleta, los atajos y la ayuda. */

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
});
const ids = (actions: readonly EditorAction[]): string[] => actions.map((action) => action.id);

describe('registro de acciones', () => {
  const actions = editorActions('es');

  it('ids y atajos únicos', () => {
    assert.equal(new Set(ids(actions)).size, actions.length);
    const chords = actions.flatMap((action) => (action.chord ? [formatChord(action.chord, false)] : []));
    assert.equal(new Set(chords).size, chords.length, chords.join(' '));
  });

  it('la barra tiene todos los comandos de formato de antes, en el mismo orden, más el Markdown del sitio, vistas, original, foco, paleta y ayuda', () => {
    assert.deepEqual(ids(actions.filter((action) => action.toolbar)), [
      'bold', 'italic', 'strike', 'code', 'heading', 'subheading', 'bulletList', 'numberedList', 'quote',
      'link', 'codeBlock', 'table', 'rule', 'image', 'figure', 'footnote', 'callout.note',
      'view.editor', 'view.split', 'view.preview', 'compare', 'focus', 'palette', 'help',
    ]);
  });

  it('la paleta lista todas las acciones salvo las de tipeo (Enter, Tab, Esc, pegar sin formato)', () => {
    const palette = ids(actions.filter(inPalette));
    for (const id of ['bold', 'rule', 'image', 'view.cycle', 'focus', 'find', 'replace', 'help']) assert.ok(palette.includes(id), id);
    for (const id of ['continueList', 'indent', 'outdent', 'plainPaste', 'dismiss', 'palette']) assert.ok(!palette.includes(id), id);
  });

  it('los atajos pedidos: Ctrl+F, Ctrl+H, Ctrl+P, Ctrl+K, Ctrl+/, Ctrl+Shift+V', () => {
    const chordOf = (id: string) => actions.find((action) => action.id === id)?.chord;
    assert.deepEqual(
      ['find', 'replace', 'palette', 'link', 'help', 'plainPaste'].map((id) => formatChord(chordOf(id)!, false)),
      ['Ctrl+F', 'Ctrl+H', 'Ctrl+P', 'Ctrl+K', 'Ctrl+/', 'Ctrl+Shift+V'],
    );
  });

  // L5: los botones H2/H3 escriben lo que dicen (## = h2, ### = h3 en el sitio y en la vista previa).
  it('H2 escribe "## " y H3 "### "', () => {
    const run = (id: string): string => {
      const action = actions.find((candidate) => candidate.id === id)!;
      assert.ok('edit' in action.run);
      const edit = action.run.edit({ value: 'Idea', start: 0, end: 0 })!;
      return applyEditToState({ value: 'Idea', start: 0, end: 0 }, edit).value;
    };
    assert.equal(run('heading'), '## Idea');
    assert.equal(run('subheading'), '### Idea');
  });

  it('una instancia por idioma (estable como dependencia de hooks)', () => {
    assert.equal(editorActions('en'), editorActions('en'));
  });
});

describe('atajos', () => {
  const actions = editorActions('es');

  it('Ctrl o Cmd; Ctrl+/ funciona aunque el teclado pida Shift para la barra (teclado español)', () => {
    assert.equal(actionForKey(key('f', { metaKey: true }), actions)?.id, 'find');
    assert.equal(actionForKey(key('/', { ctrlKey: true, shiftKey: true }), actions)?.id, 'help');
    assert.equal(actionForKey(key('Escape'), actions)?.id, 'dismiss');
  });

  it('AltGr (Ctrl+Alt en Windows) nunca dispara un atajo: escribe @, #, |…', () => {
    assert.equal(actionForKey(key('2', { ctrlKey: true, altKey: true }), actions), undefined);
    assert.equal(actionForKey(key('f', { ctrlKey: true, altKey: true }), actions), undefined);
  });

  it('formatChord: Ctrl+… en Windows/Linux; símbolos en Mac', () => {
    const strike = actions.find((action) => action.id === 'strike')!.chord!;
    assert.equal(formatChord(strike, false), 'Ctrl+Shift+X');
    assert.equal(formatChord(strike, true), '⌘⇧X');
    assert.equal(formatChord({ key: 'Escape' }, false), 'Esc');
  });

  it('commandForKey usa los textos de relleno del idioma del post', () => {
    const command = commandForKey(key('k', { ctrlKey: true }), 'en');
    assert.ok(command);
    const edit = command({ value: '', start: 0, end: 0 });
    assert.ok(edit);
    assert.deepEqual(applyEditToState({ value: '', start: 0, end: 0 }, edit), { value: '[text](url)', start: 1, end: 5 });
  });
});

describe('textos de relleno en el idioma del POST, no en el de la interfaz', () => {
  const run = (command: (typeof insertTable)['en'], value = '') => {
    const edit = command({ value, start: 0, end: 0 });
    assert.ok(edit);
    const state = applyEditToState({ value, start: 0, end: 0 }, edit);
    return `${state.value.slice(0, state.start)}«${state.value.slice(state.start, state.end)}»${state.value.slice(state.end)}`;
  };

  it('link y tabla en inglés', () => {
    assert.equal(run(insertLink.en), '[«text»](url)');
    assert.equal(run(insertTable.en), '| «Column» | Column |\n| --- | --- |\n| Value | Value |');
  });

  it('el marcador de subida', () => {
    assert.equal(uploadPlaceholder('es'), '![Subiendo…]()');
    assert.equal(uploadPlaceholder('en'), '![Uploading…]()');
  });
});

describe('fuzzy', () => {
  it('subsecuencia sin acentos ni mayúsculas; sin coincidencia, null', () => {
    assert.notEqual(fuzzyScore('titulo', 'Título'), null);
    assert.notEqual(fuzzyScore('lnum', 'Lista numerada'), null);
    assert.equal(fuzzyScore('xyz', 'Negrita'), null);
  });

  it('prefiere letras seguidas y comienzos de palabra; consulta vacía = todo, en orden', () => {
    const labels = ['Línea horizontal', 'Lista con viñetas', 'Negrita', 'Link'];
    assert.deepEqual(fuzzyFilter(labels, 'lin', (label) => label), ['Línea horizontal', 'Link', 'Lista con viñetas']);
    assert.deepEqual(fuzzyFilter(labels, 'neg', (label) => label), ['Negrita']);
    assert.deepEqual(fuzzyFilter(labels, '', (label) => label), labels);
  });

  it('busca en los textos traducidos de la paleta', () => {
    const { t } = i18nFor('en');
    const found = fuzzyFilter(editorActions('en').filter(inPalette), 'repl', (action) => t(action.label));
    assert.equal(found[0]?.id, 'replace');
  });
});

describe('vista del editor: persistida', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('por defecto dividida y sin modo foco; lo guardado se respeta', () => {
    assert.deepEqual(loadViewPrefs(storage()), DEFAULT_VIEW_PREFS);
    assert.deepEqual(DEFAULT_VIEW_PREFS, { view: 'split', focus: false });
    const store = storage();
    saveViewPrefs(store, { view: 'preview', focus: true });
    assert.deepEqual(loadViewPrefs(store), { view: 'preview', focus: true });
  });

  it('valores guardados inválidos o almacenamiento bloqueado: lo de por defecto, sin errores', () => {
    assert.deepEqual(loadViewPrefs(storage({ [VIEW_STORAGE_KEY]: '{"view":"x","focus":1}' })), DEFAULT_VIEW_PREFS);
    assert.deepEqual(loadViewPrefs(storage({ [VIEW_STORAGE_KEY]: 'no-json' })), DEFAULT_VIEW_PREFS);
    const broken = { getItem: (): string | null => { throw new Error('x'); }, setItem: (): void => { throw new Error('x'); } };
    assert.deepEqual(loadViewPrefs(broken), DEFAULT_VIEW_PREFS);
    assert.doesNotThrow(() => saveViewPrefs(broken, DEFAULT_VIEW_PREFS));
  });

  it('el atajo de vista rota editor → dividida → vista previa → editor', () => {
    assert.deepEqual([nextView('editor'), nextView('split'), nextView('preview')], ['split', 'preview', 'editor']);
  });
});

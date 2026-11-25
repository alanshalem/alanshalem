import type { MessageKey } from '../i18n/i18n.ts';
import { LANGS, type Lang } from '../languages.ts';
import {
  changeIndent,
  continueMarkdownBlock,
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  insertTable,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrike,
} from './commands.ts';
import type { Chord } from './shortcuts.ts';
import type { Command } from './types.ts';

/*
 * El registro de acciones del editor (S2, S7): UNA lista que arma la barra, la paleta de comandos, los atajos de
 * teclado y la ayuda de atajos. Sumar una acción acá la suma en los cuatro lugares.
 */

/** Acciones de la interfaz (no editan el texto); las ejecuta el componente. */
export type UiAction =
  | 'view.editor'
  | 'view.split'
  | 'view.preview'
  | 'view.cycle'
  | 'focus'
  | 'find'
  | 'replace'
  | 'image'
  | 'palette'
  | 'help'
  | 'dismiss';

/**
 * `edit`: un comando puro sobre el texto. `ui`: algo de la interfaz. `native`: lo hace el navegador y solo se
 * documenta en la ayuda (pegar sin formato).
 */
export type ActionRun = { readonly edit: Command } | { readonly ui: UiAction } | { readonly native: true };

/** Grupos de la barra (un separador entre grupos) y secciones de la ayuda. */
export type ActionGroup = 'inline' | 'heading' | 'block' | 'insert' | 'view' | 'tools' | 'typing';

export interface EditorAction {
  readonly id: string;
  readonly label: MessageKey;
  readonly group: ActionGroup;
  readonly run: ActionRun;
  readonly chord?: Chord;
  /** Aparece en la barra; su cara es `symbol` (no se traduce), `short` o el nombre completo. */
  readonly toolbar?: boolean;
  readonly symbol?: string;
  readonly short?: MessageKey;
}

const mod = (key: string, shift = false): Chord => ({ key, mod: true, shift });

function buildActions(lang: Lang): readonly EditorAction[] {
  return [
    { id: 'bold', label: 'editor.bold', group: 'inline', toolbar: true, symbol: 'B', chord: mod('b'), run: { edit: toggleBold } },
    { id: 'italic', label: 'editor.italic', group: 'inline', toolbar: true, symbol: 'I', chord: mod('i'), run: { edit: toggleItalic } },
    { id: 'strike', label: 'editor.strike', group: 'inline', toolbar: true, symbol: 'S', chord: mod('x', true), run: { edit: toggleStrike } },
    { id: 'code', label: 'editor.code', group: 'inline', toolbar: true, symbol: '</>', chord: mod('e'), run: { edit: toggleCode } },
    { id: 'heading', label: 'editor.heading', group: 'heading', toolbar: true, symbol: 'H2', run: { edit: setHeading(2) } },
    { id: 'subheading', label: 'editor.subheading', group: 'heading', toolbar: true, symbol: 'H3', run: { edit: setHeading(3) } },
    { id: 'bulletList', label: 'editor.bulletList', group: 'block', toolbar: true, symbol: '•', run: { edit: toggleBulletList } },
    { id: 'numberedList', label: 'editor.numberedList', group: 'block', toolbar: true, symbol: '1.', run: { edit: toggleNumberedList } },
    { id: 'quote', label: 'editor.quote', group: 'block', toolbar: true, symbol: '❝', run: { edit: toggleQuote } },
    { id: 'link', label: 'editor.link', group: 'insert', toolbar: true, chord: mod('k'), run: { edit: insertLink[lang] } },
    { id: 'codeBlock', label: 'editor.codeBlock', group: 'insert', toolbar: true, symbol: '{ }', run: { edit: insertCodeBlock } },
    { id: 'table', label: 'editor.table', group: 'insert', toolbar: true, run: { edit: insertTable[lang] } },
    { id: 'rule', label: 'editor.rule', group: 'insert', toolbar: true, symbol: '—', run: { edit: insertHorizontalRule } },
    { id: 'image', label: 'image.upload', group: 'insert', toolbar: true, short: 'editor.image', run: { ui: 'image' } },
    { id: 'view.editor', label: 'editor.view.editor', group: 'view', toolbar: true, short: 'editor.short.editor', run: { ui: 'view.editor' } },
    { id: 'view.split', label: 'editor.view.split', group: 'view', toolbar: true, short: 'editor.short.split', run: { ui: 'view.split' } },
    { id: 'view.preview', label: 'editor.view.preview', group: 'view', toolbar: true, short: 'common.preview', run: { ui: 'view.preview' } },
    { id: 'view.cycle', label: 'editor.view.cycle', group: 'view', chord: mod('l', true), run: { ui: 'view.cycle' } },
    { id: 'focus', label: 'editor.focus', group: 'view', toolbar: true, chord: mod('Enter', true), run: { ui: 'focus' } },
    { id: 'find', label: 'editor.find', group: 'tools', chord: mod('f'), run: { ui: 'find' } },
    { id: 'replace', label: 'editor.replace', group: 'tools', chord: mod('h'), run: { ui: 'replace' } },
    { id: 'palette', label: 'editor.palette', group: 'tools', toolbar: true, short: 'editor.short.palette', chord: mod('p'), run: { ui: 'palette' } },
    { id: 'help', label: 'editor.help', group: 'tools', toolbar: true, symbol: '?', chord: mod('/'), run: { ui: 'help' } },
    { id: 'continueList', label: 'editor.continueList', group: 'typing', chord: { key: 'Enter' }, run: { edit: continueMarkdownBlock } },
    { id: 'indent', label: 'editor.indent', group: 'typing', chord: { key: 'Tab' }, run: { edit: changeIndent(1) } },
    { id: 'outdent', label: 'editor.outdent', group: 'typing', chord: { key: 'Tab', shift: true }, run: { edit: changeIndent(-1) } },
    { id: 'plainPaste', label: 'editor.plainPaste', group: 'typing', chord: mod('v', true), run: { native: true } },
    { id: 'dismiss', label: 'editor.dismiss', group: 'typing', chord: { key: 'Escape' }, run: { ui: 'dismiss' } },
  ];
}

const ACTIONS = Object.fromEntries(LANGS.map((lang) => [lang, buildActions(lang)])) as Record<Lang, readonly EditorAction[]>;

/** El registro con los textos de relleno del idioma del post. Siempre la misma instancia por idioma. */
export const editorActions = (lang: Lang): readonly EditorAction[] => ACTIONS[lang];

/** La paleta lista todo lo que se puede ejecutar a pedido; las teclas de tipeo y la paleta misma, no. */
export const inPalette = (action: EditorAction): boolean => action.group !== 'typing' && action.id !== 'palette';

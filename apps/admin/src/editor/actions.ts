import type { MessageKey, Translate } from '../i18n/i18n.ts';
import { LANGS, type Lang } from '../languages.ts';
import {
  changeIndent,
  continueMarkdownBlock,
  insertCallout,
  insertCodeBlock,
  insertFigure,
  insertFootnote,
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
 * The editor action registry: ONE list that builds the toolbar, the command palette, the keyboard shortcuts and the
 * shortcuts help. Adding an action here adds it in all four places.
 */

/** UI actions (they do not edit the text); the component runs them. */
export type UiAction =
  | 'view.editor'
  | 'view.split'
  | 'view.preview'
  | 'view.cycle'
  | 'compare'
  | 'focus'
  | 'find'
  | 'replace'
  | 'image'
  | 'palette'
  | 'help'
  | 'dismiss';

/**
 * `edit`: a pure command on the text. `ui`: something of the UI. `native`: the browser does it and it is only
 * documented in the help (paste as plain text).
 */
export type ActionRun = { readonly edit: Command } | { readonly ui: UiAction } | { readonly native: true };

/** Toolbar groups (a separator between groups) and help sections. */
export type ActionGroup = 'inline' | 'heading' | 'block' | 'insert' | 'view' | 'tools' | 'typing';

export interface EditorAction {
  readonly id: string;
  readonly label: MessageKey;
  readonly group: ActionGroup;
  readonly run: ActionRun;
  readonly chord?: Chord;
  /** Shows in the toolbar; its face is `symbol` (not translated), `short` or the full name. */
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
    { id: 'figure', label: 'editor.figure', group: 'insert', toolbar: true, short: 'editor.short.figure', run: { edit: insertFigure[lang] } },
    { id: 'footnote', label: 'editor.footnote', group: 'insert', toolbar: true, symbol: '¹', run: { edit: insertFootnote[lang] } },
    // In the toolbar, only the most common callout; all three are in the palette.
    { id: 'callout.note', label: 'editor.callout.note', group: 'insert', toolbar: true, short: 'editor.short.callout', run: { edit: insertCallout('note')[lang] } },
    { id: 'callout.tip', label: 'editor.callout.tip', group: 'insert', run: { edit: insertCallout('tip')[lang] } },
    { id: 'callout.warning', label: 'editor.callout.warning', group: 'insert', run: { edit: insertCallout('warning')[lang] } },
    { id: 'view.editor', label: 'editor.view.editor', group: 'view', toolbar: true, short: 'editor.short.editor', run: { ui: 'view.editor' } },
    { id: 'view.split', label: 'editor.view.split', group: 'view', toolbar: true, short: 'editor.short.split', run: { ui: 'view.split' } },
    { id: 'view.preview', label: 'editor.view.preview', group: 'view', toolbar: true, short: 'common.preview', run: { ui: 'view.preview' } },
    { id: 'view.cycle', label: 'editor.view.cycle', group: 'view', chord: mod('l', true), run: { ui: 'view.cycle' } },
    { id: 'compare', label: 'editor.compare', group: 'view', toolbar: true, short: 'editor.short.compare', run: { ui: 'compare' } },
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

/** The registry with the placeholder texts of the post's language. Always the same instance per language. */
export const editorActions = (lang: Lang): readonly EditorAction[] => ACTIONS[lang];

/** What depends on context: uploading images (if there is somewhere to) and viewing the original (if another version exists). */
export const availableActions = (
  actions: readonly EditorAction[],
  { canUpload, canCompare }: { canUpload: boolean; canCompare: boolean },
): readonly EditorAction[] =>
  actions.filter((action) => (canUpload || action.id !== 'image') && (canCompare || action.id !== 'compare'));

/**
 * A toolbar button's face and its accessible name. The name starts with what is visible (WCAG 2.5.3: voice control
 * users say "H2" or "1.") and continues with the description; if the description already starts with the face
 * ("Figura" → "Figura con epígrafe"), it is not repeated.
 */
export function toolbarLabels(action: EditorAction, t: Translate): { face: string; name: string } {
  const full = t(action.label);
  const face = action.symbol ?? t(action.short ?? action.label);
  const name = full.startsWith(face) ? full : `${face} – ${full}`;
  return { face, name };
}

/** The palette lists everything that can run on demand; typing keys and the palette itself do not. */
export const inPalette = (action: EditorAction): boolean => action.group !== 'typing' && action.id !== 'palette';

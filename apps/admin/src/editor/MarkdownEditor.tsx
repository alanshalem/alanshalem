import type { RenderResult } from '@blog/markdown';
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { IMAGE_ACCEPT } from '../media.ts';
import { availableActions, editorActions, inPalette, type EditorAction, type UiAction } from './actions.ts';
import { applyEditToTextarea } from './applyEdit.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { insertText, pasteUrlAsLink } from './commands.ts';
import { EditorToolbar } from './EditorToolbar.tsx';
import { FindPanel } from './FindPanel.tsx';
import { htmlToMarkdown } from './htmlToMarkdown.ts';
import type { DocumentStats, OutlineEntry } from './preview.ts';
import { actionForKey, isMacPlatform, rememberKey, tabLeavesEditor } from './shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { lineOffsets } from './text.ts';
import { measureOffsetTops, scrollTextareaTo } from './textareaMetrics.ts';
import type { Command } from './types.ts';
import { useEditorView } from './useEditorView.ts';
import { useFind } from './useFind.ts';
import { isImageFile, useImageUpload } from './useImageUpload.ts';
import { useScrollSync } from './useScrollSync.ts';
import { nextView, type EditorView } from './view.ts';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The POST's language (not the UI's): spell checker and the commands' placeholder texts. */
  lang: Lang;
  /** Uploads the image and returns its URL. If not passed, the editor does not accept images. */
  onUploadImage?: (file: File) => Promise<string>;
  /** `value` already rendered as on the site (usePostPreview): the HTML and its anchor lines, for the synced scroll. */
  preview: Pick<RenderResult, 'html' | 'blockStarts' | 'anchorLines'>;
  /** The other version already rendered: with it "Ver el original al lado" shows up. */
  original: { html: string; lang: Lang } | null;
  stats: DocumentStats;
  ref?: Ref<EditorHandle>;
}

/** What the page can ask the editor from outside (the reviewer and the outline). */
export interface EditorHandle {
  goToLine: (line: number) => void;
  goToHeading: (entry: OutlineEntry) => void;
}

type Dialog = 'palette' | 'help';

const IS_MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform);

/**
 * Native Markdown editor: a <textarea> + pure commands + preview.
 *
 * The preview uses the SAME renderer and options as the public build (usePostPreview) and the same styles
 * (.paper .prose), so what shows here is what gets published. With "Ver el original", that panel shows the other
 * version (read-only) and the synced scroll pairs it block by block with what is being written.
 * The injected HTML is safe: the renderer escapes all text and filters URLs.
 *
 * Everything that can be done comes from the action registry (actions.ts); this component only wires: text commands
 * go through applyEdit (native undo) and UI actions through `runUi`.
 */
export function MarkdownEditor({ value, onChange, lang, onUploadImage, preview, original, stats, ref }: Props) {
  const { t, plural } = useUiLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plainPasteRef = useRef(false);
  // The previous key in the textarea: Esc and then Tab moves focus out even with the caret in a list (2.1.2).
  const previousKeyRef = useRef<string | null>(null);
  // The action chosen in the palette only runs once the dialog has closed (and focus is back in the editor).
  const pendingRef = useRef<EditorAction | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Not remembered between visits (unlike the view): it only makes sense in a translation.
  const [comparing, setComparing] = useState(false);
  const { view, focus, setView, setFocus } = useEditorView();
  const find = useFind(textareaRef, value);
  const upload = useImageUpload(textareaRef, lang, onUploadImage);

  const showingOriginal = comparing && original !== null;
  const shown = showingOriginal ? original : { html: preview.html, lang };
  const originalLabel = showingOriginal ? t('editor.original', { lang: t(`lang.inSentence.${original.lang}`) }) : null;
  const onEditorScroll = useScrollSync(textareaRef, previewRef, view === 'split', shown.html, preview);

  const actions = useMemo(
    () => availableActions(editorActions(lang), { canUpload: upload.canUpload, canCompare: original !== null }),
    [lang, upload.canUpload, original !== null],
  );

  const applyCommand = (command: Command): boolean => {
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const edit = command({ value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd });
    if (!edit) return false;
    applyEditToTextarea(textarea, edit);
    return true;
  };

  /**
   * Changes the view and moves focus to the panel left visible: otherwise hiding the focused textarea leaves focus on
   * <body> and the next shortcuts no longer reach the editor. flushSync: the panel must exist to focus it.
   */
  const changeView = (next: EditorView): void => {
    flushSync(() => setView(next));
    (next === 'preview' ? previewRef : textareaRef).current?.focus();
  };

  /** Editing or searching with the preview alone: the editor shows up first. */
  const showEditor = (): void => {
    if (view === 'preview') changeView('split');
  };

  /** Runs a UI action; `false` if there was nothing to do (Esc without a panel or focus mode). */
  const runUi = (ui: UiAction): boolean => {
    switch (ui) {
      case 'view.editor':
      case 'view.split':
      case 'view.preview':
        changeView(ui === 'view.editor' ? 'editor' : ui === 'view.split' ? 'split' : 'preview');
        return true;
      case 'view.cycle':
        changeView(nextView(view));
        return true;
      case 'compare':
        // The original replaces the preview: when enabled it shows next to the editor.
        if (!comparing && view !== 'split') changeView('split');
        setComparing(!comparing);
        return true;
      case 'focus':
        setFocus(!focus);
        return true;
      case 'find':
      case 'replace':
        showEditor();
        find.open(ui);
        return true;
      case 'image':
        fileInputRef.current?.click();
        return true;
      case 'palette':
      case 'help':
        setDialog(ui);
        return true;
      case 'dismiss':
        if (find.mode) find.close();
        else if (focus) setFocus(false);
        else return false;
        return true;
    }
  };

  /**
   * Moves the caret to the start of `line` and brings it into view (`toTop`: at the very top, like the start of a
   * section). In the split view the preview follows: scrolling the textarea triggers the sync.
   */
  const goToLine = (line: number, toTop = false): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    showEditor();
    const [offset = 0] = lineOffsets(textarea.value, [line]);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const top = measureOffsetTops(textarea, [offset])[0] ?? 0;
    // Minus the top padding: the heading gets the same room as the start of the text.
    if (toTop) textarea.scrollTop = top - parseFloat(getComputedStyle(textarea).paddingTop);
    else scrollTextareaTo(textarea, top);
  };

  /** With the preview alone (or no known line) the preview scrolls: nobody's view gets changed. */
  const goToHeading = (entry: OutlineEntry): void => {
    if (entry.line !== null && view !== 'preview') return goToLine(entry.line, true);
    const preview = previewRef.current;
    const target = preview?.querySelector(`[id="${CSS.escape(entry.id)}"]`);
    if (!preview || !target) return;
    preview.scrollTop += target.getBoundingClientRect().top - preview.getBoundingClientRect().top;
    preview.focus({ preventScroll: true });
  };

  useImperativeHandle(ref, () => ({ goToLine: (line) => goToLine(line), goToHeading }));

  const runAction = (action: EditorAction): void => {
    if ('edit' in action.run) {
      showEditor();
      applyCommand(action.run.edit);
    } else if ('ui' in action.run) {
      runUi(action.run.ui);
    }
  };

  useEffect(() => {
    if (dialog) return;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) runAction(pending);
    // Only when a dialog closes; `runAction` changes on every render and would re-run the action.
  }, [dialog]);

  const closeDialog = (): void => {
    setDialog(null);
    textareaRef.current?.focus();
  };

  // UI shortcuts from anywhere in the editor (toolbar, find panel, preview).
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (dialog || event.nativeEvent.isComposing) return;
    const run = actionForKey(event.nativeEvent, actions)?.run;
    if (run && 'ui' in run && runUi(run.ui)) event.preventDefault();
  };

  // Text shortcuts only inside the textarea (Tab in the search box must not nest a list).
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return; // do not interfere with IME keyboards
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = rememberKey(previousKey, event.nativeEvent.key);
    if (tabLeavesEditor(event.nativeEvent, previousKey)) return; // native Tab: focus leaves the editor
    const action = actionForKey(event.nativeEvent, actions);
    plainPasteRef.current = action?.id === 'plainPaste';
    if (action && 'edit' in action.run && applyCommand(action.run.edit)) event.preventDefault();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const plain = plainPasteRef.current;
    plainPasteRef.current = false;
    const images = Array.from(event.clipboardData.files).filter(isImageFile);
    if (images.length > 0 && upload.canUpload) {
      event.preventDefault();
      upload.uploadImages(images);
      return;
    }
    if (plain) return; // Ctrl+Shift+V: the textarea's native paste is already plain text
    if (applyCommand(pasteUrlAsLink(event.clipboardData.getData('text/plain')))) {
      event.preventDefault();
      return;
    }
    // HTML with real formatting → Markdown; without formatting, the plain text as is (native paste).
    const converted = htmlToMarkdown(event.clipboardData.getData('text/html'));
    if (converted.formatted && applyCommand(insertText(converted.markdown))) event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    const images = Array.from(event.dataTransfer.files).filter(isImageFile);
    if (images.length === 0 || !upload.canUpload) return;
    event.preventDefault();
    upload.uploadImages(images);
  };

  const isPressed = (action: EditorAction): boolean | undefined => {
    if (action.id === 'focus') return focus;
    if (action.id === 'compare') return comparing;
    return action.group === 'view' ? action.id === `view.${view}` : undefined;
  };

  return (
    <div className="editor" data-view={view} data-focus={focus || undefined} onKeyDown={handleEditorKeyDown}>
      <EditorToolbar actions={actions} mac={IS_MAC} isPressed={isPressed} onRun={runAction} />
      {upload.canUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            upload.uploadImages(Array.from(event.target.files ?? []));
            event.target.value = ''; // allows choosing the same file again
          }}
        />
      )}
      {find.mode && <FindPanel find={find} />}

      <div className="editor-panes">
        <div className="editor-input-wrap">
          <textarea
            ref={textareaRef}
            className="editor-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onScroll={() => {
              onEditorScroll();
              find.onTextareaScroll();
            }}
            spellCheck
            lang={lang}
            aria-label={t('editor.contentLabel')}
            placeholder={t('editor.placeholder')}
          />
          {find.mode && find.highlight && (
            <span
              className="find-highlight"
              aria-hidden="true"
              style={{
                top: find.highlight.top,
                left: find.highlight.left,
                width: find.highlight.width,
                height: find.highlight.height,
              }}
            />
          )}
        </div>
        {/* tabIndex: with the preview alone, shortcuts must be able to arrive from here (and it scrolls by keyboard).
            role="region": an aria-label on a div without a role is not announced; as a region, it is found and named. */}
        <div
          ref={previewRef}
          className="paper editor-preview"
          role="region"
          aria-label={originalLabel ?? t('common.preview')}
          tabIndex={0}
        >
          {originalLabel && <p className="editor-original-label">{originalLabel}</p>}
          <div className="prose" lang={shown.lang} dangerouslySetInnerHTML={{ __html: shown.html }} />
        </div>
      </div>

      <div className="editor-statusbar">
        <div className="editor-status" role="status" aria-live="polite">
          {upload.status ?? (focus ? t('editor.focusHint') : null)}
        </div>
        {/* Outside the live region: it changes with every word and announcing it would be noise. */}
        <p className="editor-stats">
          {plural(stats.words, 'stats.words')} · {plural(stats.characters, 'stats.characters')} ·{' '}
          {t('stats.reading', { minutes: stats.readingMinutes })}
        </p>
      </div>

      {dialog === 'palette' && (
        <CommandPalette
          actions={actions.filter(inPalette)}
          mac={IS_MAC}
          onClose={closeDialog}
          onRun={(action) => {
            pendingRef.current = action;
            closeDialog();
          }}
        />
      )}
      {dialog === 'help' && <ShortcutsHelp actions={actions} mac={IS_MAC} onClose={closeDialog} />}
    </div>
  );
}

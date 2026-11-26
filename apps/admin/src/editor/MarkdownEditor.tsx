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
import { availableActions, editorActions, inPalette, type EditorAction, type UiAction } from './actions.ts';
import { applyEditToTextarea } from './applyEdit.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { insertText, pasteUrlAsLink } from './commands.ts';
import { EditorToolbar } from './EditorToolbar.tsx';
import { FindPanel } from './FindPanel.tsx';
import { htmlToMarkdown } from './htmlToMarkdown.ts';
import type { DocumentStats, OutlineEntry } from './preview.ts';
import { actionForKey, isMacPlatform } from './shortcuts.ts';
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
  /** Idioma del POST (no de la interfaz): corrector ortográfico y textos de relleno de los comandos. */
  lang: Lang;
  /** Sube la imagen y devuelve su URL. Si no se pasa, el editor no acepta imágenes. */
  onUploadImage?: (file: File) => Promise<string>;
  /** `value` ya renderizado como en el sitio (usePostPreview). */
  previewHtml: string;
  /** La otra versión ya renderizada: con ella aparece "Ver el original al lado" (S5). */
  original: { html: string; lang: Lang } | null;
  stats: DocumentStats;
  ref?: Ref<EditorHandle>;
}

/** Lo que la página puede pedirle al editor desde afuera (el revisor y el esquema). */
export interface EditorHandle {
  goToLine: (line: number) => void;
  goToHeading: (entry: OutlineEntry) => void;
}

type Dialog = 'palette' | 'help';

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const IS_MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform);

/**
 * Editor Markdown nativo: un <textarea> + comandos puros + vista previa.
 *
 * La vista previa usa el MISMO renderer y las mismas opciones que el build público (usePostPreview) y los mismos
 * estilos (.paper .prose), así que lo que se ve acá es lo que se publica. Con "Ver el original", ese panel muestra la
 * otra versión (solo lectura) y el scroll sincronizado la empareja bloque a bloque con lo que se escribe.
 * El HTML que se inyecta es seguro: el renderer escapa todo el texto y filtra las URLs.
 *
 * Todo lo que se puede hacer sale del registro de acciones (actions.ts); este componente solo conecta: los
 * comandos de texto pasan por applyEdit (deshacer nativo) y las acciones de interfaz, por `runUi`.
 */
export function MarkdownEditor({ value, onChange, lang, onUploadImage, previewHtml, original, stats, ref }: Props) {
  const { t, plural } = useUiLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plainPasteRef = useRef(false);
  // La acción elegida en la paleta corre recién cuando el diálogo se cerró (y el foco volvió al editor).
  const pendingRef = useRef<EditorAction | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // No se recuerda entre visitas (a diferencia de la vista): solo tiene sentido en una traducción.
  const [comparing, setComparing] = useState(false);
  const { view, focus, setView, setFocus } = useEditorView();
  const find = useFind(textareaRef, value);
  const upload = useImageUpload(textareaRef, lang, onUploadImage);

  const showingOriginal = comparing && original !== null;
  const shown = showingOriginal ? original : { html: previewHtml, lang };
  const originalLabel = showingOriginal ? t('editor.original', { lang: t(`lang.inSentence.${original.lang}`) }) : null;
  const onEditorScroll = useScrollSync(textareaRef, previewRef, view === 'split', shown.html);

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
   * Cambia la vista y lleva el foco al panel que queda visible: si no, ocultar el textarea enfocado deja el foco en
   * <body> y los atajos siguientes ya no llegan al editor. flushSync: el panel tiene que existir para enfocarlo.
   */
  const changeView = (next: EditorView): void => {
    flushSync(() => setView(next));
    (next === 'preview' ? previewRef : textareaRef).current?.focus();
  };

  /** Editar o buscar con la vista previa sola: primero aparece el editor. */
  const showEditor = (): void => {
    if (view === 'preview') changeView('split');
  };

  /** Ejecuta una acción de interfaz; `false` si no había nada que hacer (Esc sin panel ni modo foco). */
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
        // El original reemplaza a la vista previa: al activarlo se ve al lado del editor.
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
   * Lleva el cursor al principio de `line` y la deja a la vista (`toTop`: arriba de todo, como el comienzo de una
   * sección). En la vista dividida la vista previa la sigue: mover el scroll del textarea dispara la sincronización.
   */
  const goToLine = (line: number, toTop = false): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    showEditor();
    const [offset = 0] = lineOffsets(textarea.value, [line]);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const top = measureOffsetTops(textarea, [offset])[0] ?? 0;
    // Menos el relleno superior: el título queda con el mismo aire que el comienzo del texto.
    if (toTop) textarea.scrollTop = top - parseFloat(getComputedStyle(textarea).paddingTop);
    else scrollTextareaTo(textarea, top);
  };

  /** Con la vista previa sola (o sin línea conocida) se mueve la vista previa: no se le cambia la vista a nadie. */
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
    // Solo al cerrar un diálogo; `runAction` cambia en cada render y re-ejecutaría la acción.
  }, [dialog]);

  const closeDialog = (): void => {
    setDialog(null);
    textareaRef.current?.focus();
  };

  // Atajos de interfaz desde cualquier lugar del editor (barra, panel de búsqueda, vista previa).
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (dialog || event.nativeEvent.isComposing) return;
    const run = actionForKey(event.nativeEvent, actions)?.run;
    if (run && 'ui' in run && runUi(run.ui)) event.preventDefault();
  };

  // Atajos de texto solo dentro del textarea (Tab en el buscador no tiene que anidar una lista).
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return; // no interferir con teclados IME
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
    if (plain) return; // Ctrl+Shift+V: el pegado nativo del textarea ya es texto plano
    if (applyCommand(pasteUrlAsLink(event.clipboardData.getData('text/plain')))) {
      event.preventDefault();
      return;
    }
    // HTML con formato real → Markdown; sin formato, el texto plano tal cual (pegado nativo).
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
          accept={IMAGE_TYPES}
          multiple
          hidden
          onChange={(event) => {
            upload.uploadImages(Array.from(event.target.files ?? []));
            event.target.value = ''; // permite volver a elegir el mismo archivo
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
        {/* tabIndex: con la vista previa sola, los atajos tienen que poder llegar desde acá (y se scrollea con teclado). */}
        <div
          ref={previewRef}
          className="paper editor-preview"
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
        {/* Fuera de la región viva: cambia con cada palabra y anunciarlo sería ruido. */}
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

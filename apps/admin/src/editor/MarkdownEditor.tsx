import { renderMarkdown } from '@blog/markdown';
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { MessageKey } from '../i18n/i18n.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { applyEditToTextarea } from './applyEdit.ts';
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertTable,
  pasteUrlAsLink,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrike,
} from './commands.ts';
import { commandForKey } from './shortcuts.ts';
import type { Command } from './types.ts';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Sube la imagen y devuelve su URL. Si no se pasa, el editor no acepta imágenes. */
  onUploadImage?: (file: File) => Promise<string>;
}

interface ToolbarAction {
  /** Lo que se ve en el botón; sin símbolo, el botón muestra su nombre ("Link", "Tabla"). */
  symbol?: string;
  name: MessageKey;
  /** Se agrega al nombre en el título ("Negrita (Ctrl+B)"); las teclas no se traducen. */
  shortcut?: string;
  command: Command;
}

const TOOLBAR: Array<ToolbarAction | 'separator'> = [
  { symbol: 'B', name: 'editor.bold', shortcut: 'Ctrl+B', command: toggleBold },
  { symbol: 'I', name: 'editor.italic', shortcut: 'Ctrl+I', command: toggleItalic },
  { symbol: 'S', name: 'editor.strike', shortcut: 'Ctrl+Shift+X', command: toggleStrike },
  { symbol: '</>', name: 'editor.code', shortcut: 'Ctrl+E', command: toggleCode },
  'separator',
  { symbol: 'H2', name: 'editor.heading', command: setHeading(2) },
  { symbol: 'H3', name: 'editor.subheading', command: setHeading(3) },
  'separator',
  { symbol: '•', name: 'editor.bulletList', command: toggleBulletList },
  { symbol: '1.', name: 'editor.numberedList', command: toggleNumberedList },
  { symbol: '❝', name: 'editor.quote', command: toggleQuote },
  'separator',
  { name: 'editor.link', shortcut: 'Ctrl+K', command: insertLink },
  { symbol: '{ }', name: 'editor.codeBlock', command: insertCodeBlock },
  { name: 'editor.table', command: insertTable },
  { symbol: '—', name: 'editor.rule', command: insertHorizontalRule },
];

const isImageFile = (file: File): boolean => file.type.startsWith('image/');

/**
 * Editor Markdown nativo: un <textarea> + comandos puros + vista previa.
 *
 * La vista previa usa el MISMO renderer que el build público (@blog/markdown) y los mismos estilos
 * (.paper .prose), así que lo que se ve acá es lo que se publica.
 * El HTML que se inyecta es seguro: el renderer escapa todo el texto y filtra las URLs.
 */
export function MarkdownEditor({ value, onChange, onUploadImage }: Props) {
  const { t } = useUiLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write'); // solo se usa en pantallas angostas
  const [status, setStatus] = useState<string | null>(null);

  // useDeferredValue: tipear nunca espera al render de la vista previa.
  const deferredValue = useDeferredValue(value);
  const previewHtml = useMemo(() => renderMarkdown(deferredValue, { headingOffset: 1 }).html, [deferredValue]);

  const run = (command: Command): boolean => {
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const edit = command({ value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd });
    if (!edit) return false;
    applyEditToTextarea(textarea, edit);
    return true;
  };

  const uploadAndInsert = async (files: File[]): Promise<void> => {
    if (!onUploadImage) return;
    for (const file of files) {
      setStatus(t('upload.progress', { name: file.name }));
      try {
        const url = await onUploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        run(insertImage(url, alt));
        setStatus(null);
      } catch (error) {
        const reason = error instanceof Error ? error.message : t('error.unknown');
        setStatus(t('upload.failed', { name: file.name, error: reason }));
        return;
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return; // no interferir con teclados IME
    const command = commandForKey(event.nativeEvent);
    if (command && run(command)) event.preventDefault();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const images = Array.from(event.clipboardData.files).filter(isImageFile);
    if (images.length > 0 && onUploadImage) {
      event.preventDefault();
      void uploadAndInsert(images);
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (run(pasteUrlAsLink(text))) event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    const images = Array.from(event.dataTransfer.files).filter(isImageFile);
    if (images.length === 0 || !onUploadImage) return;
    event.preventDefault();
    void uploadAndInsert(images);
  };

  return (
    <div className="editor" data-tab={tab}>
      <div className="editor-toolbar" role="toolbar" aria-label={t('editor.format')}>
        {TOOLBAR.map((item, index) => {
          if (item === 'separator') {
            return <span key={`sep-${index}`} className="toolbar-separator" aria-hidden="true" />;
          }
          const name = t(item.name);
          const title = item.shortcut ? `${name} (${item.shortcut})` : name;
          return (
            <button
              key={item.name}
              type="button"
              className="toolbar-button"
              title={title}
              aria-label={title}
              onClick={() => run(item.command)}
            >
              {item.symbol ?? name}
            </button>
          );
        })}
        {onUploadImage && (
          <>
            <button
              type="button"
              className="toolbar-button"
              title={t('image.upload')}
              aria-label={t('image.upload')}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('editor.image')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              multiple
              hidden
              onChange={(event) => {
                void uploadAndInsert(Array.from(event.target.files ?? []));
                event.target.value = ''; // permite volver a elegir el mismo archivo
              }}
            />
          </>
        )}

        <div className="editor-tabs" role="tablist" aria-label={t('editor.view')}>
          <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
            {t('editor.write')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
            {t('common.preview')}
          </button>
        </div>
      </div>

      <div className="editor-panes">
        <textarea
          ref={textareaRef}
          className="editor-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          spellCheck
          lang="es"
          aria-label={t('editor.contentLabel')}
          placeholder={t('editor.placeholder')}
        />
        <div className="paper editor-preview" aria-label={t('common.preview')}>
          <div className="prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>

      <div className="editor-status" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

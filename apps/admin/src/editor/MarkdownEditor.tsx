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
  label: string;
  title: string;
  command: Command;
}

const TOOLBAR: Array<ToolbarAction | 'separator'> = [
  { label: 'B', title: 'Negrita (Ctrl+B)', command: toggleBold },
  { label: 'I', title: 'Cursiva (Ctrl+I)', command: toggleItalic },
  { label: 'S', title: 'Tachado (Ctrl+Shift+X)', command: toggleStrike },
  { label: '</>', title: 'Código en línea (Ctrl+E)', command: toggleCode },
  'separator',
  { label: 'H2', title: 'Título', command: setHeading(2) },
  { label: 'H3', title: 'Subtítulo', command: setHeading(3) },
  'separator',
  { label: '•', title: 'Lista con viñetas', command: toggleBulletList },
  { label: '1.', title: 'Lista numerada', command: toggleNumberedList },
  { label: '❝', title: 'Cita', command: toggleQuote },
  'separator',
  { label: 'Link', title: 'Link (Ctrl+K)', command: insertLink },
  { label: '{ }', title: 'Bloque de código', command: insertCodeBlock },
  { label: 'Tabla', title: 'Tabla', command: insertTable },
  { label: '—', title: 'Línea horizontal', command: insertHorizontalRule },
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
      setStatus(`Subiendo ${file.name}…`);
      try {
        const url = await onUploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        run(insertImage(url, alt));
        setStatus(null);
      } catch (error) {
        setStatus(`No se pudo subir ${file.name}: ${error instanceof Error ? error.message : 'error desconocido'}`);
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
      <div className="editor-toolbar" role="toolbar" aria-label="Formato">
        {TOOLBAR.map((item, index) =>
          item === 'separator' ? (
            <span key={`sep-${index}`} className="toolbar-separator" aria-hidden="true" />
          ) : (
            <button
              key={item.title}
              type="button"
              className="toolbar-button"
              title={item.title}
              aria-label={item.title}
              onClick={() => run(item.command)}
            >
              {item.label}
            </button>
          ),
        )}
        {onUploadImage && (
          <>
            <button
              type="button"
              className="toolbar-button"
              title="Subir imagen"
              aria-label="Subir imagen"
              onClick={() => fileInputRef.current?.click()}
            >
              Imagen
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

        <div className="editor-tabs" role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
            Escribir
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
            Vista previa
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
          aria-label="Contenido en Markdown"
          placeholder="Escribí en Markdown…"
        />
        <div className="paper editor-preview" aria-label="Vista previa">
          <div className="prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>

      <div className="editor-status" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

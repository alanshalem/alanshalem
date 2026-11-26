import { useRef, useState, type RefObject } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { applyEditKeepingFocus, applyEditToTextarea } from './applyEdit.ts';
import { blockSpan, imageMarkdown, insertBlock, uploadPlaceholder } from './commands.ts';
import { nearestOccurrence } from './search.ts';
import { spliceKeepingSelection } from './text.ts';

export const isImageFile = (file: File): boolean => file.type.startsWith('image/');

/** "mi-foto_2.png" → "mi foto 2": un punto de partida para el texto alternativo. */
const altFromFileName = (name: string): string => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

const stateOf = (textarea: HTMLTextAreaElement) => ({
  value: textarea.value,
  start: textarea.selectionStart,
  end: textarea.selectionEnd,
});

/**
 * Pegar, soltar o elegir imágenes (S2): cada una deja un marcador `![Subiendo…]()` en un párrafo propio donde estaba
 * el cursor (insertBlock), se sube con el cliente de siempre (el servidor la optimiza; sin las reglas de tamaño del
 * hero) y el marcador se reemplaza por la imagen o, si falla, se quita con sus líneas en blanco (blockSpan). Las dos
 * ediciones pasan por applyEdit: Ctrl+Z las deshace. Una a la vez, en orden: una cola de promesas.
 */
export function useImageUpload(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  lang: Lang,
  upload: ((file: File) => Promise<string>) | undefined,
) {
  const { t } = useUiLanguage();
  const [status, setStatus] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /** `true` si subió; ante un error se cortan las que quedaban (el mensaje dice cuál falló). */
  const uploadOne = async (file: File): Promise<boolean> => {
    const textarea = textareaRef.current;
    if (!textarea || !upload) return false;
    const placeholder = uploadPlaceholder(lang);
    const insertedAt = textarea.selectionStart;
    const edit = insertBlock(placeholder)(stateOf(textarea));
    if (edit) applyEditToTextarea(textarea, edit);
    setStatus(t('upload.progress', { name: file.name }));

    let replacement = '';
    let ok = true;
    try {
      replacement = imageMarkdown(await upload(file), altFromFileName(file.name));
      setStatus(null);
    } catch (error) {
      ok = false;
      setStatus(t('upload.failed', { name: file.name, error: error instanceof Error ? error.message : t('error.unknown') }));
    }

    // Mientras subía se pudo seguir escribiendo: se busca el marcador cerca de donde quedó y no se mueve el cursor.
    const from = nearestOccurrence(textarea.value, placeholder, insertedAt);
    if (from !== -1) {
      const to = from + placeholder.length;
      const span = ok ? { from, to } : blockSpan(textarea.value, from, to);
      applyEditKeepingFocus(textarea, spliceKeepingSelection(stateOf(textarea), span.from, span.to, replacement));
    }
    return ok;
  };

  const uploadImages = (files: readonly File[]): void => {
    queueRef.current = queueRef.current.then(async () => {
      for (const file of files) if (!(await uploadOne(file))) return;
    });
  };

  return { status, uploadImages, canUpload: upload !== undefined };
}

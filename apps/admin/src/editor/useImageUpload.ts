import { useRef, useState, type RefObject } from 'react';
import { errorMessage } from '../api/problem.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { applyEditKeepingFocus, applyEditToTextarea } from './applyEdit.ts';
import { blockSpan, imageMarkdown, insertBlock, uploadPlaceholder } from './commands.ts';
import { nearestOccurrence } from './search.ts';
import { spliceKeepingSelection } from './text.ts';

export const isImageFile = (file: File): boolean => file.type.startsWith('image/');

/** "mi-foto_2.png" → "mi foto 2": a starting point for the alt text. */
const altFromFileName = (name: string): string => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

const stateOf = (textarea: HTMLTextAreaElement) => ({
  value: textarea.value,
  start: textarea.selectionStart,
  end: textarea.selectionEnd,
});

/**
 * Pasting, dropping or picking images: each one leaves a `![Subiendo…]()` marker in its own paragraph where the caret
 * was (insertBlock), uploads with the usual client (the server optimizes it; without the hero's size rules) and the
 * marker is replaced by the image or, on failure, removed with its blank lines (blockSpan). Both edits go through
 * applyEdit: Ctrl+Z undoes them. One at a time, in order: a promise queue.
 */
export function useImageUpload(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  lang: Lang,
  upload: ((file: File) => Promise<string>) | undefined,
) {
  const { t } = useUiLanguage();
  const [status, setStatus] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /** `true` if it uploaded; on an error the remaining ones are cancelled (the message says which one failed). */
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
      setStatus(t('upload.failed', { name: file.name, error: errorMessage(error, t('error.unknown')) }));
    }

    // Typing may have continued during the upload: find the marker near where it was and do not move the caret.
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

import { useRef, useState, type RefObject } from 'react';
import { errorMessage } from '../api/problem.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import type { Lang } from '../languages.ts';
import { applyEditKeepingFocus, applyEditToTextarea } from './applyEdit.ts';
import { codeBlocks, readCodeFile, type CodeFileEntry } from './codeFiles.ts';
import { blockSpan, imageMarkdown, insertBlock, uploadPlaceholder } from './commands.ts';
import { acceptsFileDrag, planTransfer, problemMessage, type TransferOptions, type TransferProblem } from './pasteFiles.ts';
import { nearestOccurrence } from './search.ts';
import { spliceKeepingSelection } from './text.ts';

/** By MIME type only. Paste and drop use `takeTransfer` (pasteFiles.ts), which also knows files without a type. */
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
 *
 * `takeTransfer` carries out a paste or drop plan (pasteFiles.ts): text/code files become fenced blocks
 * (codeFiles.ts), images copied from a page without a file are inserted by their web address, and what cannot be
 * inserted is said in the status line instead of disappearing.
 */
export function useImageUpload(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  lang: Lang,
  upload: ((file: File) => Promise<string>) | undefined,
) {
  const { t } = useUiLanguage();
  const [status, setStatus] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * null if it uploaded; otherwise the failure message, already shown (the caller cancels the remaining ones), or ''
   * when there is no editor or no upload function (nothing to say).
   */
  const uploadOne = async (file: File): Promise<string | null> => {
    const textarea = textareaRef.current;
    if (!textarea || !upload) return '';
    const placeholder = uploadPlaceholder(lang);
    const insertedAt = textarea.selectionStart;
    const edit = insertBlock(placeholder)(stateOf(textarea));
    if (edit) applyEditToTextarea(textarea, edit);
    setStatus(t('upload.progress', { name: file.name }));

    let replacement = '';
    let failure: string | null = null;
    try {
      replacement = imageMarkdown(await upload(file), altFromFileName(file.name));
      setStatus(null);
    } catch (error) {
      failure = t('upload.failed', { name: file.name, error: errorMessage(error, t('error.unknown')) });
      setStatus(failure);
    }

    // Typing may have continued during the upload: find the marker near where it was and do not move the caret.
    const from = nearestOccurrence(textarea.value, placeholder, insertedAt);
    if (from !== -1) {
      const to = from + placeholder.length;
      const span = failure === null ? { from, to } : blockSpan(textarea.value, from, to);
      applyEditKeepingFocus(textarea, spliceKeepingSelection(stateOf(textarea), span.from, span.to, replacement));
    }
    return failure;
  };

  /** Uploads in order; the first failure stops the rest and stays in the status line. */
  const uploadAll = async (files: readonly File[]): Promise<string | null> => {
    for (const file of files) {
      const failure = await uploadOne(file);
      if (failure !== null) return failure;
    }
    return null;
  };

  const uploadImages = (files: readonly File[]): void => {
    queueRef.current = queueRef.current.then(async () => void (await uploadAll(files)));
  };

  /** Inserts `markdown` as its own block at the caret (native undo). */
  const insertAtCaret = (markdown: string): void => {
    const textarea = textareaRef.current;
    if (!textarea || markdown === '') return;
    const edit = insertBlock(markdown)(stateOf(textarea));
    if (edit) applyEditToTextarea(textarea, edit);
  };

  /**
   * A paste (`clipboardData`) or a drop (`dataTransfer`) into the editor. `true` = handled: the caller calls
   * `preventDefault()`. `false` = the native paste or the editor's text handling goes on as before.
   * The DataTransfer is read synchronously here (browsers empty it once the event handler returns).
   */
  const takeTransfer = (transfer: DataTransfer, options: TransferOptions): boolean => {
    const plan = planTransfer(transfer, options);
    switch (plan.kind) {
      case 'native':
        return false;
      case 'remoteImages':
        insertAtCaret(plan.markdown);
        setStatus(null);
        return true;
      case 'imageWithoutAddress':
        setStatus(problemMessage({ kind: 'imageWithoutAddress' }, t));
        return true;
      case 'files': {
        const problems: TransferProblem[] = plan.other.map((file) => ({ kind: 'unsupported', name: file.name }));
        const images = upload ? plan.images : [];
        if (plan.images.length > 0 && !upload) problems.push({ kind: 'cannotUpload' });
        queueRef.current = queueRef.current.then(async () => {
          const entries: CodeFileEntry[] = [];
          for (const file of plan.code) {
            const read = await readCodeFile(file);
            if (read.ok) entries.push(read.entry);
            else problems.push({ kind: read.reason, name: file.name });
          }
          if (entries.length > 0) insertAtCaret(codeBlocks(entries));
          const failure = await uploadAll(images);
          const messages = [failure, ...problems.map((problem) => problemMessage(problem, t))].filter((text) => !!text);
          setStatus(messages.length > 0 ? messages.join(' ') : null);
        });
        return true;
      }
    }
  };

  /** For `onDragOver`: accepting a drag with files keeps the browser from opening the file instead of the admin. */
  const acceptsDrag = (transfer: DataTransfer): boolean => acceptsFileDrag(transfer);

  return { status, uploadImages, takeTransfer, acceptsDrag, canUpload: upload !== undefined };
}

import type { TextEdit } from './types.ts';

/**
 * Applies an edit to the real <textarea>.
 *
 * `execCommand('insertText')` is used because it is the only way for the change to enter the browser's NATIVE undo
 * stack (Ctrl+Z / Ctrl+Shift+Z work without us implementing anything). Assigning `textarea.value = ...` would wipe
 * that history. It also fires the `input` event, so React finds out on its own.
 *
 * `execCommand` is marked obsolete but is still supported in every browser and has no replacement for this case. If it
 * ever fails, the `setRangeText` fallback keeps the editor working (only the undo of that edit is lost).
 */
export function applyEditToTextarea(textarea: HTMLTextAreaElement, edit: TextEdit): void {
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);

  if (edit.from === edit.to && edit.insert === '') {
    // Empty edit: only move the selection ("delete" on a cursor would delete a character).
    textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
    return;
  }

  // An empty insert (deleting) uses "delete" so it does not depend on how the browser treats an empty text.
  const done =
    edit.insert === ''
      ? document.execCommand('delete')
      : document.execCommand('insertText', false, edit.insert);

  if (!done) {
    textarea.setRangeText(edit.insert, edit.from, edit.to, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
}

/**
 * The same, but returns focus to where it was: execCommand needs the textarea focused, and an edit that comes from
 * elsewhere (replacing from the panel, an upload that finishes) must not steal anyone's focus.
 */
export function applyEditKeepingFocus(textarea: HTMLTextAreaElement, edit: TextEdit): void {
  const previous = document.activeElement;
  applyEditToTextarea(textarea, edit);
  if (previous instanceof HTMLElement && previous !== textarea) previous.focus({ preventScroll: true });
}

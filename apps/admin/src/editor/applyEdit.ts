import type { TextEdit } from './types.ts';

/**
 * Aplica una edición al <textarea> real.
 *
 * Se usa `execCommand('insertText')` porque es la única forma de que el cambio entre en la pila
 * de deshacer NATIVA del navegador (Ctrl+Z / Ctrl+Shift+Z funcionan sin que implementemos nada).
 * Asignar `textarea.value = ...` borraría ese historial. Además dispara el evento `input`,
 * así que React se entera solo.
 *
 * `execCommand` está marcado como obsoleto pero sigue soportado en todos los navegadores
 * y no tiene reemplazo para este caso. Si algún día falla, el fallback con `setRangeText`
 * mantiene el editor funcionando (solo se pierde el deshacer de esa edición).
 */
export function applyEditToTextarea(textarea: HTMLTextAreaElement, edit: TextEdit): void {
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);

  if (edit.from === edit.to && edit.insert === '') {
    // Edición vacía: solo mover la selección ("delete" sobre un cursor borraría un carácter).
    textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
    return;
  }

  // Un insert vacío (borrar) se hace con "delete" para no depender de cómo trate el navegador un texto vacío.
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
 * Igual, pero devuelve el foco a donde estaba: execCommand necesita el textarea enfocado, y una edición que llega
 * desde otro lado (reemplazar desde el panel, una subida que termina) no tiene que robarle el foco a nadie.
 */
export function applyEditKeepingFocus(textarea: HTMLTextAreaElement, edit: TextEdit): void {
  const previous = document.activeElement;
  applyEditToTextarea(textarea, edit);
  if (previous instanceof HTMLElement && previous !== textarea) previous.focus({ preventScroll: true });
}

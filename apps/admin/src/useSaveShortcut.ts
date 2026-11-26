import { useEffect, useRef } from 'react';
import { matchesChord, SAVE_CHORD } from './editor/shortcuts.ts';

/**
 * Ctrl/Cmd+S guarda (editor de posts y ajustes) en vez de abrir "Guardar página" del navegador. El ref evita
 * re-registrar el listener en cada tecla: `save` cambia en cada render.
 */
export function useSaveShortcut(save: () => unknown): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesChord(event, SAVE_CHORD)) return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

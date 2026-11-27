import { useEffect, useRef } from 'react';
import { matchesChord, SAVE_CHORD } from './editor/shortcuts.ts';

/**
 * Ctrl/Cmd+S saves (post editor and settings) instead of opening the browser's "Save page". The ref avoids
 * re-registering the listener on every key: `save` changes on every render.
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

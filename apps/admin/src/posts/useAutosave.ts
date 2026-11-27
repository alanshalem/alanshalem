import { useEffect, useRef } from 'react';
import { AUTOSAVE_DELAY_MS } from './autosave.ts';

/**
 * Calls `save` after AUTOSAVE_DELAY_MS without changes in `snapshot` (the serialized form) while `enabled`
 * (canAutosave). Every change restarts the wait; `enabled` is false during a save, so when one finishes with new
 * changes it waits again instead of overlapping requests.
 */
export function useAutosave(enabled: boolean, snapshot: string, save: () => void): void {
  // The ref avoids restarting the wait when only the identity of `save` changed (it changes on every render).
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, snapshot]);
}

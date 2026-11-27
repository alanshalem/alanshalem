import { useEffect, useRef } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { registerLeaveGuard, type LeaveGuard } from './leaveGuard.ts';

/**
 * Warns before losing changes: inside the admin (useRoute and `confirmNavigation` consult the guard) and when closing
 * or reloading the tab (beforeunload). `dirty` is the form's: autosave sets it back to false.
 */
export function useUnsavedGuard(dirty: boolean): void {
  const { t } = useUiLanguage();
  const guard = useRef<LeaveGuard>({ dirty, message: '' });
  guard.current = { dirty, message: t('unsaved.confirm') };

  useEffect(() => registerLeaveGuard(guard), []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

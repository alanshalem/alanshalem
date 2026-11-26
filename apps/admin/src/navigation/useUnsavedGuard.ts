import { useEffect, useRef } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { registerLeaveGuard, type LeaveGuard } from './leaveGuard.ts';

/**
 * Avisa antes de perder cambios (P1-5): dentro del admin (useRoute y `confirmNavigation` consultan el guardia) y al
 * cerrar o recargar la pestaña (beforeunload). `dirty` es el del formulario: el guardado automático lo deja en false.
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

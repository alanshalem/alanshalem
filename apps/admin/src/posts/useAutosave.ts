import { useEffect, useRef } from 'react';
import { AUTOSAVE_DELAY_MS } from './autosave.ts';

/**
 * Llama a `save` cuando pasan AUTOSAVE_DELAY_MS sin cambios en `snapshot` (el formulario serializado) mientras
 * `enabled` (canAutosave). Cada cambio reinicia la espera; `enabled` es falso durante un guardado, así que al terminar
 * uno con cambios nuevos se vuelve a esperar en vez de superponer pedidos.
 */
export function useAutosave(enabled: boolean, snapshot: string, save: () => void): void {
  // El ref evita reiniciar la espera cuando solo cambió la identidad de `save` (cambia en cada render).
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, snapshot]);
}

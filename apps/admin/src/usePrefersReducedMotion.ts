import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const subscribe = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/**
 * Si el sistema pide reducir el movimiento (se actualiza si el usuario lo cambia con la página abierta). Lo usan el
 * editor de video y las miniaturas con video: nada se mueve solo sin que se pida (WCAG 2.2.2).
 */
export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED_MOTION).matches);

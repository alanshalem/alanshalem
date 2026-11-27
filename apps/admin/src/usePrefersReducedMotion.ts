import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const subscribe = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/**
 * Whether the system asks to reduce motion (updates if the user changes it with the page open). Used by the video
 * editor and the video thumbnails: nothing moves on its own unless asked (WCAG 2.2.2).
 */
export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED_MOTION).matches);

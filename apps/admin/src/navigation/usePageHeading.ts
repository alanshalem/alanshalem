import { useEffect, useRef, type RefObject } from 'react';
import { hasViewChanged } from '../useRoute.ts';

/** The view's document title (pageTitle): the tab and the screen reader say where you are. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * On arriving at a new view (a link, back, after logging in) focus moves to its <h1> (tabindex -1): the screen reader
 * announces the new view and the next Tab continues from there, not from the top of the page. The first view after
 * loading is left alone: there the reader already reads the page from the top (and the "Saltar al contenido" link).
 */
export function useHeadingFocus(): RefObject<HTMLHeadingElement | null> {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hasViewChanged()) ref.current?.focus();
  }, []);
  return ref;
}

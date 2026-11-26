import { useEffect, useRef, type RefObject } from 'react';
import { hasViewChanged } from '../useRoute.ts';

/** El título del documento de la vista (pageTitle): la pestaña y el lector de pantalla dicen dónde se está. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * Al llegar a una vista nueva (un enlace, atrás, después de entrar) el foco va a su <h1> (tabindex -1): el lector de
 * pantalla anuncia la vista nueva y el próximo Tab sigue desde ahí, no desde el principio de la página. La primera
 * vista después de cargar no se toca: ahí el lector ya lee la página desde arriba (y el enlace "Saltar al contenido").
 */
export function useHeadingFocus(): RefObject<HTMLHeadingElement | null> {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hasViewChanged()) ref.current?.focus();
  }, []);
  return ref;
}

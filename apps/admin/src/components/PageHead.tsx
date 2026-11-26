import { useEffect, useRef, type ReactNode } from 'react';
import { useDocumentTitle, useHeadingFocus } from '../navigation/usePageHeading.ts';

interface Props {
  /** Lo que dice el <h1>. */
  heading: ReactNode;
  /** El título del documento (pageTitle). */
  documentTitle: string;
  /** Arriba del título: el eyebrow o "← Posts". */
  above?: ReactNode;
  /** Las acciones a la derecha (Guardar, Publicar). */
  children?: ReactNode;
  /** Fijo arriba al scrollear (editor, ajustes): sus acciones quedan siempre a mano en pantallas grandes. */
  sticky?: boolean;
}

/**
 * Encabezado de página: el título de la vista (documento y <h1>, que recibe el foco al cambiar de vista) y sus acciones.
 * Si es fijo, publica su alto en `--sticky-head` para que `scroll-padding-top` (admin.css) no deje controles
 * enfocados debajo de él (WCAG 2.4.11). El CSS decide cuándo es fijo; acá solo se mide.
 */
export function PageHead({ heading, documentTitle, above, children, sticky = false }: Props) {
  const headingRef = useHeadingFocus();
  const headRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(documentTitle);

  useEffect(() => {
    const head = headRef.current;
    if (!sticky || !head) return;
    const root = document.documentElement;
    // ResizeObserver: el alto cambia con el ancho (las acciones bajan de renglón) y con títulos largos.
    const observer = new ResizeObserver(() => root.style.setProperty('--sticky-head', `${head.offsetHeight}px`));
    observer.observe(head);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--sticky-head');
    };
  }, [sticky]);

  return (
    <div ref={headRef} className={sticky ? 'page-head page-head-sticky' : 'page-head'}>
      <div>
        {above}
        <h1 ref={headingRef} className="page-title" tabIndex={-1}>
          {heading}
        </h1>
      </div>
      {children}
    </div>
  );
}

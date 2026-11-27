import { useEffect, useRef, type ReactNode } from 'react';
import { useDocumentTitle, useHeadingFocus } from '../navigation/usePageHeading.ts';

interface Props {
  /** What the <h1> says. */
  heading: ReactNode;
  /** The document title (pageTitle). */
  documentTitle: string;
  /** Above the heading: the eyebrow or "← Posts". */
  above?: ReactNode;
  /** The actions on the right (Guardar, Publicar). */
  children?: ReactNode;
  /** Sticky at the top while scrolling (editor, settings): its actions stay at hand on large screens. */
  sticky?: boolean;
}

/**
 * Page header: the view's title (document and <h1>, which receives focus on view change) and its actions.
 * When sticky, it publishes its height in `--sticky-head` so `scroll-padding-top` (admin.css) does not leave focused
 * controls under it (WCAG 2.4.11). The CSS decides when it is sticky; here it is only measured.
 */
export function PageHead({ heading, documentTitle, above, children, sticky = false }: Props) {
  const headingRef = useHeadingFocus();
  const headRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(documentTitle);

  useEffect(() => {
    const head = headRef.current;
    if (!sticky || !head) return;
    const root = document.documentElement;
    // ResizeObserver: the height changes with the width (the actions wrap) and with long titles.
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

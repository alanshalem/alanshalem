import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';

interface Props {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Native modal dialog (<dialog> + showModal): the browser makes the rest of the page inert (focus does not leave) and
 * Esc fires `cancel`. It is mounted only while open; whoever opens it decides where focus returns.
 */
export function Modal({ title, onClose, className, children }: Props) {
  const { t } = useUiLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal ${className ?? ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // React closes it by unmounting, not the browser
        onClose();
      }}
      // A click on the backdrop (outside the box) closes it.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal-head">
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <button type="button" className="ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      {children}
    </dialog>
  );
}

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';

interface Props {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Diálogo modal nativo (<dialog> + showModal): el navegador vuelve inerte el resto de la página (el foco no sale)
 * y Esc dispara `cancel`. Se monta solo mientras está abierto; quien lo abre decide adónde vuelve el foco.
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
        event.preventDefault(); // lo cierra React al desmontarlo, no el navegador
        onClose();
      }}
      // Un clic en el fondo (fuera de la caja) cierra.
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

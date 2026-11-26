import { useCallback, useEffect, useRef, useState } from 'react';
import type { HeroImageInput } from '../api/types.ts';
import { ImagePreview } from '../components/ImagePreview.tsx';
import { Modal } from '../editor/Modal.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { useUnsavedGuard } from '../navigation/useUnsavedGuard.ts';
import { neighbors, panelLeaveConfirmation, type HeroTile } from './heroGrid.ts';
import { HeroImageForm } from './HeroImageForm.tsx';
import { previewSourceUrl } from './heroVideo.ts';
import { editSummary } from './videoEdit.ts';

interface Props {
  tile: HeroTile;
  /** Los ítems que se veían al abrir el panel (con el filtro de ese momento): Anterior y Siguiente se mueven entre ellos. */
  ids: readonly string[];
  onMove: (id: string) => void;
  onClose: () => void;
  onSave: (input: HeroImageInput) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * Edición de un ítem guardado (U7): panel lateral (pantalla completa en celulares) sobre el <dialog> nativo del
 * editor (Modal: foco atrapado, Esc cierra; el foco vuelve a la miniatura, lo decide la galería). Vista previa grande
 * (el video, mudo y solo si no se pidió reducir el movimiento), los textos y Anterior/Siguiente sin cerrar. Con
 * cambios sin guardar, cerrar o moverse pregunta antes (la regla de leaveGuard).
 */
export function HeroPanel({ tile, ids, onMove, onClose, onSave, onDelete }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const { image, number, kind } = tile;
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  useUnsavedGuard(dirty); // cambiar de vista o cerrar la pestaña con el panel a medio editar también pregunta
  const { previous, next, position, total } = neighbors(ids, image.id);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Chrome no deja cancelar dos Esc seguidos sin otra interacción en el medio (anti-abuso de CloseWatcher): el
  // <dialog> se cierra solo aunque se haya respondido "Cancelar". Si el panel sigue montado, se vuelve a abrir.
  useEffect(() => {
    const dialog = bodyRef.current?.closest('dialog');
    if (!dialog) return;
    const reopen = (): void => {
      if (dialog.isConnected && !dialog.open) dialog.showModal();
    };
    dialog.addEventListener('close', reopen);
    return () => dialog.removeEventListener('close', reopen);
  }, []);

  const leave = (go: () => void): void => {
    const question = panelLeaveConfirmation(dirty, i18n);
    if (question !== null && !window.confirm(question)) return;
    setDirty(false);
    go();
  };

  // aria-disabled (no `disabled`): en el primero o el último el botón sigue enfocable y el foco no se pierde.
  const step = (target: string | null, label: string, arrow: { before?: string; after?: string }) => (
    <button
      type="button"
      aria-disabled={target === null ? true : undefined}
      onClick={() => target !== null && leave(() => onMove(target))}
    >
      {arrow.before && <span aria-hidden="true">{arrow.before}</span>}
      {label}
      {arrow.after && <span aria-hidden="true">{arrow.after}</span>}
    </button>
  );

  return (
    <Modal title={t(`hero.panelTitle.${kind}`, { n: number })} onClose={() => leave(onClose)} className="hero-panel">
      <div className="hero-panel-body" ref={bodyRef}>
        <ImagePreview
          key={image.id}
          src={image.media.url}
          video={image.video ? previewSourceUrl(image.video) : null}
          alt={image.alt}
          emptyText={t('hero.noPreview')}
          color={image.media.color}
          placeholder={image.media.placeholder}
        />
        <HeroImageForm
          key={image.id}
          head={image.video ? <p className="chip hero-card-summary">{editSummary(image.video.edit, i18n)}</p> : undefined}
          saved={{ alt: image.alt, credit: image.credit, altEn: image.altEn }}
          saveLabel={t('hero.saveChanges')}
          onSave={onSave}
          onDirtyChange={onDirtyChange}
          doneText={`${t('hero.changesSaved')} ${t('hero.rebuilding')}`}
          remove={{
            label: t('hero.delete'),
            tone: 'danger',
            onClick: () => (window.confirm(t(`hero.confirmDelete.${kind}`)) ? onDelete() : undefined),
          }}
        />
      </div>
      <div className="hero-panel-nav">
        {step(previous, t('hero.previous'), { before: '← ' })}
        <span className="hero-panel-position">{position > 0 && t('hero.position', { position, total })}</span>
        {step(next, t('hero.next'), { after: ' →' })}
      </div>
    </Modal>
  );
}

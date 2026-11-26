import { useEffect, useRef, useState } from 'react';
import { Banner } from '../components/Banner.tsx';
import { ImagePreview } from '../components/ImagePreview.tsx';
import type { I18n, MessageKey } from '../i18n/i18n.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { IMAGE_ACCEPT } from '../media.ts';
import { HeroImageCard } from './HeroImageCard.tsx';
import { countHeroItems, focusAfterRemoval, HERO_FILTERS, heroCountText, heroTiles, type HeroFilter } from './heroGrid.ts';
import { discardConfirmation, thumbnailUrl } from './heroImage.ts';
import { HeroPanel } from './HeroPanel.tsx';
import { heroGuidance } from './heroSize.ts';
import { HeroTileGrid } from './HeroTileGrid.tsx';
import { previewSourceUrl, VIDEO_ACCEPT } from './heroVideo.ts';
import { useHeroImages, type PendingUpload, type UploadStatus } from './useHeroImages.ts';
import { VideoEditor } from './VideoEditor.tsx';
import { editSummary } from './videoEdit.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

// Un solo control para los dos tipos: el hook reparte cada archivo según su MIME.
const HERO_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;

// "Subiendo…" es el mismo texto de los botones de subida.
const UPLOAD_BADGES: Record<UploadStatus, { text: MessageKey; tone?: 'error' }> = {
  editing: { text: 'hero.badge.editing' },
  queued: { text: 'hero.badge.queued' },
  uploading: { text: 'common.uploading' },
  processing: { text: 'hero.badge.processing' },
  uploaded: { text: 'hero.badge.uploaded' },
  failed: { text: 'hero.badge.failed', tone: 'error' },
};

function pendingThumbnail({ kind, status, previewUrl, video }: PendingUpload, { t }: I18n) {
  const alt = t('common.preview');
  const noPreview = t('hero.noPreview');
  if (video?.poster) {
    return (
      <ImagePreview
        src={thumbnailUrl(video.poster)}
        video={previewSourceUrl(video)}
        alt={alt}
        emptyText={noPreview}
        color={video.poster.color}
        placeholder={video.poster.placeholder}
      />
    );
  }
  // La URL local de un video es para el editor; como miniatura, un video se ve recién procesado.
  if (kind === 'photo') return <ImagePreview src={previewUrl} alt={alt} emptyText={noPreview} />;
  // Un video recién se puede ver cuando la API terminó de procesarlo (antes no hay póster ni fuente H.264).
  return <ImagePreview src={null} alt={alt} emptyText={status === 'failed' ? noPreview : t('hero.previewLater')} />;
}

/** El panel abierto: qué ítem y entre cuáles se mueve (los visibles al abrirlo; no cambian si el filtro lo deja afuera). */
interface OpenPanel {
  id: string;
  ids: readonly string[];
}

/**
 * Fotos y videos del hero (S3, S4, S9): subir varios a la vez con la guía de tamaño a la vista (S10, S12),
 * describir cada uno (texto alternativo y crédito), editarlos y borrarlos. Cada ítem se guarda por separado,
 * fuera del formulario de ajustes. Los archivos en curso son tarjetas (necesitan el editor y el texto antes de
 * guardar); los guardados, una grilla de miniaturas con filtros que abre un panel lateral (U7: con 50 ítems, una
 * ficha por ítem era enorme).
 */
export function HeroGallery({ onError }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const gallery = useHeroImages(onError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const [filter, setFilter] = useState<HeroFilter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<OpenPanel | null>(null);
  // Al cerrar el panel el foco vuelve a la miniatura del último ítem visto (después de que el <dialog> se cierra).
  const [returnFocus, setReturnFocus] = useState<{ id: string | null } | null>(null);

  const allTiles = heroTiles(gallery.images, 'all');
  const tiles = heroTiles(gallery.images, filter);
  const counts = countHeroItems(gallery.images);
  const openTile = panel ? allTiles.find((tile) => tile.image.id === panel.id) : undefined;

  useEffect(() => {
    if (!returnFocus) return;
    setReturnFocus(null);
    const grid = gridRef.current;
    const byId = returnFocus.id ? grid?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(returnFocus.id)}"]`) : null;
    // Si el filtro lo dejó afuera (por ejemplo, ya tiene inglés), a la miniatura activa; sin miniaturas, a Subir.
    const target = byId ?? grid?.querySelector<HTMLButtonElement>('button[tabindex="0"]') ?? uploadRef.current;
    if (target?.dataset.id) setActiveId(target.dataset.id);
    target?.focus();
  }, [returnFocus]);

  const closePanel = (focusId: string | null): void => {
    setPanel(null);
    setReturnFocus({ id: focusId });
  };

  const deleteOpen = async (): Promise<void> => {
    if (!panel || !openTile) return;
    const focusId = focusAfterRemoval(tiles.map((tile) => tile.image.id), panel.id);
    await gallery.deleteImage(openTile.image);
    closePanel(focusId);
  };

  const renderPending = (upload: PendingUpload) => (
    <li key={upload.key}>
      <HeroImageCard
        title={upload.fileName}
        badge={{ ...UPLOAD_BADGES[upload.status], text: t(UPLOAD_BADGES[upload.status].text) }}
        summary={upload.video ? editSummary(upload.video.edit, i18n) : undefined}
        thumbnail={
          upload.status === 'editing' && upload.previewUrl && upload.durationSeconds !== null ? (
            <VideoEditor
              src={upload.previewUrl}
              durationSeconds={upload.durationSeconds}
              onConfirm={(edit) => gallery.uploadEdited(upload, edit)}
            />
          ) : (
            pendingThumbnail(upload, i18n)
          )
        }
        canSave={upload.status === 'uploaded'}
        error={upload.error}
        warnings={upload.warnings}
        saveLabel={t('common.save')}
        onSave={(input) => gallery.savePending(upload, input)}
        remove={{
          label: t('hero.discard'),
          tone: 'ghost',
          onClick: () => {
            const question = discardConfirmation(upload, i18n);
            if (question === null || window.confirm(question)) gallery.discardPending(upload);
          },
        }}
      />
    </li>
  );

  const renderSaved = () => (
    <>
      <div className="hero-toolbar">
        <p className="hero-count" aria-live="polite">
          {heroCountText(counts, i18n)}
          {filter !== 'all' && ` · ${t('hero.showing', { shown: tiles.length })}`}
        </p>
        <div className="segmented" role="group" aria-label={t('hero.filterLabel')}>
          {HERO_FILTERS.map((option) => (
            <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>
              {t(`hero.filter.${option}`)}{' '}
              <span className="segmented-count">{counts[option]}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="help" id="hero-grid-help">
        {t('hero.gridHelp')}
      </p>
      {filter !== 'all' && tiles.length === 0 ? (
        <p className="help hero-empty">{t(`hero.filterEmpty.${filter}`)}</p>
      ) : (
        <HeroTileGrid
          ref={gridRef}
          tiles={tiles}
          activeId={activeId}
          onActiveChange={setActiveId}
          onOpen={(id) => setPanel({ id, ids: tiles.map((tile) => tile.image.id) })}
          describedBy="hero-grid-help"
        />
      )}
      {panel && openTile && (
        <HeroPanel
          tile={openTile}
          ids={panel.ids}
          onMove={(id) => setPanel({ ...panel, id })}
          onClose={() => closePanel(panel.id)}
          onSave={(input) => gallery.updateImage(panel.id, input)}
          onDelete={deleteOpen}
        />
      )}
    </>
  );

  return (
    <section className="settings-section" aria-labelledby="settings-hero">
      <div className="section-head">
        <h2 id="settings-hero">{t('hero.title')}</h2>
        <p className="section-note">{t('hero.note')}</p>
      </div>

      <p className="hero-guidance" id="hero-guidance">
        {heroGuidance(i18n)}
      </p>

      <div className="hero-upload">
        <button ref={uploadRef} type="button" aria-describedby="hero-guidance" onClick={() => fileInputRef.current?.click()}>
          {t('hero.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={HERO_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            gallery.addFiles(Array.from(event.target.files ?? []));
            event.target.value = ''; // permite volver a elegir los mismos archivos
          }}
        />
        <p className="help">{t('hero.uploadHelp')}</p>
      </div>

      <p className="field-status" role="status" aria-live="polite">
        {gallery.notice}
      </p>

      {gallery.pending.length > 0 && (
        <ul className="hero-list" aria-label={t('hero.pendingList')}>
          {gallery.pending.map(renderPending)}
        </ul>
      )}

      {gallery.loading ? (
        <p className="help">{t('common.loading')}</p>
      ) : gallery.loadError ? (
        <Banner notice={{ kind: 'error', text: gallery.loadError }} />
      ) : gallery.images.length === 0 ? (
        <p className="help hero-empty">{t('hero.empty')}</p>
      ) : (
        renderSaved()
      )}
    </section>
  );
}

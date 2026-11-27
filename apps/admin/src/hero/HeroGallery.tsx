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
  /** Returns true if the error was an expired session (already handled). */
  onError: (error: unknown) => boolean;
}

// One control for both kinds: the hook routes each file by its MIME.
const HERO_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;

// "Subiendo…" is the same text as the upload buttons'.
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
  // A video's local URL is for the editor; as a thumbnail, a video only shows once processed.
  if (kind === 'photo') return <ImagePreview src={previewUrl} alt={alt} emptyText={noPreview} />;
  // A video can only be shown once the API finished processing it (before that there is no poster or H.264 source).
  return <ImagePreview src={null} alt={alt} emptyText={status === 'failed' ? noPreview : t('hero.previewLater')} />;
}

/** The open panel: which item and which ones it moves between (those visible when opened; they stay if the filter drops it). */
interface OpenPanel {
  id: string;
  ids: readonly string[];
}

/**
 * Hero photos and videos: upload several at once with the size guide in view, describe each one (alt text and
 * credit), edit and delete them. Each item is saved separately, outside the settings form. Files in progress are
 * cards (they need the editor and the text before saving); saved ones are a filtered thumbnail grid that opens a side
 * panel (with 50 items, one card per item was huge).
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
  // When the panel closes focus returns to the thumbnail of the last item seen (after the <dialog> closes).
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
    // If the filter dropped it (for example, it now has English), to the active thumbnail; without thumbnails, to Subir.
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
            event.target.value = ''; // allows choosing the same files again
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

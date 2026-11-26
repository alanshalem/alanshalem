import { useRef } from 'react';
import type { HeroImage } from '../api/types.ts';
import { Banner } from '../components/Banner.tsx';
import { ImagePreview } from '../components/ImagePreview.tsx';
import type { I18n, MessageKey } from '../i18n/i18n.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { IMAGE_ACCEPT } from '../media.ts';
import { HeroImageCard } from './HeroImageCard.tsx';
import { thumbnailUrl } from './heroImage.ts';
import { heroGuidance } from './heroSize.ts';
import { heroItemKind, previewSourceUrl, VIDEO_ACCEPT } from './heroVideo.ts';
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

/**
 * Fotos y videos del hero (S3, S4, S9): subir varios a la vez con la guía de tamaño a la vista (S10, S12),
 * describir cada uno (texto alternativo y crédito), editarlos y borrarlos. Cada ítem se guarda por separado,
 * fuera del formulario de ajustes.
 */
export function HeroGallery({ onError }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const gallery = useHeroImages(onError);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        remove={{ label: t('hero.discard'), tone: 'ghost', onClick: () => gallery.discardPending(upload) }}
      />
    </li>
  );

  const renderSaved = (image: HeroImage, index: number) => {
    const kind = heroItemKind(image);
    return (
      <li key={image.id}>
        <HeroImageCard
          title={t('hero.savedTitle', { n: index + 1 })}
          badge={kind === 'video' ? { text: t('hero.badge.video') } : undefined}
          summary={image.video ? editSummary(image.video.edit, i18n) : undefined}
          thumbnail={
            <ImagePreview
              src={thumbnailUrl(image.media)}
              alt={image.alt}
              emptyText={t('hero.noPreview')}
              color={image.media.color}
              placeholder={image.media.placeholder}
            />
          }
          saved={{ alt: image.alt, credit: image.credit, altEn: image.altEn, creditEn: image.creditEn }}
          saveLabel={t('hero.saveChanges')}
          onSave={(input) => gallery.updateImage(image.id, input)}
          remove={{
            label: t('hero.delete'),
            tone: 'danger',
            onClick: () => (window.confirm(t(`hero.confirmDelete.${kind}`)) ? gallery.deleteImage(image) : undefined),
          }}
        />
      </li>
    );
  };

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
        <button type="button" aria-describedby="hero-guidance" onClick={() => fileInputRef.current?.click()}>
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
        <ol className="hero-list" aria-label={t('hero.savedList')}>
          {gallery.images.map(renderSaved)}
        </ol>
      )}
    </section>
  );
}

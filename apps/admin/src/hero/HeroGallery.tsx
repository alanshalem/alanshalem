import { useRef } from 'react';
import type { HeroImage } from '../api/types.ts';
import { IMAGE_ACCEPT } from '../components/ImageField.tsx';
import { ImagePreview } from '../components/ImagePreview.tsx';
import { HeroImageCard } from './HeroImageCard.tsx';
import { thumbnailUrl } from './heroImage.ts';
import { HERO_GUIDANCE } from './heroSize.ts';
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

const UPLOAD_BADGES: Record<UploadStatus, { text: string; tone?: 'error' }> = {
  editing: { text: 'Sin subir' },
  queued: { text: 'En cola' },
  uploading: { text: 'Subiendo…' },
  processing: { text: 'Procesando…' },
  uploaded: { text: 'Sin guardar' },
  failed: { text: 'Error', tone: 'error' },
};

const VIDEO_BADGE = { text: 'Video' };
const NO_PREVIEW = 'Sin vista previa';
// Un video recién se puede ver cuando la API terminó de procesarlo (antes no hay póster ni fuente H.264).
const VIDEO_PREVIEW_LATER = 'La vista previa aparece al terminar el proceso';

const DELETE_QUESTIONS = {
  photo: '¿Eliminar esta foto del hero? Deja de aparecer en la home.',
  video: '¿Eliminar este video del hero? Deja de aparecer en la home.',
} as const;

function pendingThumbnail({ kind, status, previewUrl, video }: PendingUpload) {
  if (video?.poster) {
    return (
      <ImagePreview
        src={thumbnailUrl(video.poster)}
        video={previewSourceUrl(video)}
        alt="Vista previa"
        emptyText={NO_PREVIEW}
        color={video.poster.color}
        placeholder={video.poster.placeholder}
      />
    );
  }
  // La URL local de un video es para el editor; como miniatura, un video se ve recién procesado.
  if (kind === 'photo') return <ImagePreview src={previewUrl} alt="Vista previa" emptyText={NO_PREVIEW} />;
  return <ImagePreview src={null} alt="Vista previa" emptyText={status === 'failed' ? NO_PREVIEW : VIDEO_PREVIEW_LATER} />;
}

/**
 * Fotos y videos del hero (S3, S4, S9): subir varios a la vez con la guía de tamaño a la vista (S10, S12),
 * describir cada uno (texto alternativo y crédito), editarlos y borrarlos. Cada ítem se guarda por separado,
 * fuera del formulario de ajustes.
 */
export function HeroGallery({ onError }: Props) {
  const gallery = useHeroImages(onError);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const renderPending = (upload: PendingUpload) => (
    <li key={upload.key}>
      <HeroImageCard
        title={upload.fileName}
        badge={UPLOAD_BADGES[upload.status]}
        summary={upload.video ? editSummary(upload.video.edit) : undefined}
        thumbnail={
          upload.status === 'editing' && upload.previewUrl && upload.durationSeconds !== null ? (
            <VideoEditor
              src={upload.previewUrl}
              durationSeconds={upload.durationSeconds}
              onConfirm={(edit) => gallery.uploadEdited(upload, edit)}
            />
          ) : (
            pendingThumbnail(upload)
          )
        }
        canSave={upload.status === 'uploaded'}
        error={upload.error}
        warnings={upload.warnings}
        saveLabel="Guardar"
        onSave={(input) => gallery.savePending(upload, input)}
        remove={{ label: 'Descartar', tone: 'ghost', onClick: () => gallery.discardPending(upload) }}
      />
    </li>
  );

  const renderSaved = (image: HeroImage, index: number) => {
    const kind = heroItemKind(image);
    return (
      <li key={image.id}>
        <HeroImageCard
          title={`N.º ${index + 1}`}
          badge={kind === 'video' ? VIDEO_BADGE : undefined}
          summary={image.video ? editSummary(image.video.edit) : undefined}
          thumbnail={
            <ImagePreview
              src={thumbnailUrl(image.media)}
              alt={image.alt}
              emptyText={NO_PREVIEW}
              color={image.media.color}
              placeholder={image.media.placeholder}
            />
          }
          saved={{ alt: image.alt, credit: image.credit }}
          saveLabel="Guardar cambios"
          onSave={(input) => gallery.updateImage(image.id, input)}
          remove={{
            label: 'Eliminar',
            tone: 'danger',
            onClick: () => (window.confirm(DELETE_QUESTIONS[kind]) ? gallery.deleteImage(image) : undefined),
          }}
        />
      </li>
    );
  };

  return (
    <section className="settings-section" aria-labelledby="settings-hero">
      <div className="section-head">
        <h2 id="settings-hero">Fotos y videos del hero</h2>
        <p className="section-note">
          La home muestra uno al azar en cada visita, nunca el mismo dos veces seguidas. Cada cambio regenera el sitio.
        </p>
      </div>

      <p className="hero-guidance" id="hero-guidance">
        {HERO_GUIDANCE}
      </p>

      <div className="hero-upload">
        <button type="button" aria-describedby="hero-guidance" onClick={() => fileInputRef.current?.click()}>
          Subir fotos o videos
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
        <p className="help">
          Podés elegir varios a la vez; se optimizan al subir. Antes de subir un video elegís el tramo y el fundido.
          Cada uno necesita su texto alternativo antes de guardarlo.
        </p>
      </div>

      <p className="field-status" role="status" aria-live="polite">
        {gallery.notice}
      </p>

      {gallery.pending.length > 0 && (
        <ul className="hero-list" aria-label="Por guardar">
          {gallery.pending.map(renderPending)}
        </ul>
      )}

      {gallery.loading ? (
        <p className="help">Cargando…</p>
      ) : gallery.loadError ? (
        <p className="banner banner-error" role="alert">
          {gallery.loadError}
        </p>
      ) : gallery.images.length === 0 ? (
        <p className="help hero-empty">
          Todavía no hay fotos ni videos: la home usa la foto por defecto del sitio si existe; si no, un hero tipográfico
          oscuro.
        </p>
      ) : (
        <ol className="hero-list" aria-label="Guardados">
          {gallery.images.map(renderSaved)}
        </ol>
      )}
    </section>
  );
}

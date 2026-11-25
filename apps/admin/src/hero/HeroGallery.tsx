import { useRef } from 'react';
import { IMAGE_ACCEPT } from '../components/ImageField.tsx';
import { ImagePreview } from '../components/ImagePreview.tsx';
import { HeroImageCard } from './HeroImageCard.tsx';
import { thumbnailUrl } from './heroImage.ts';
import { useHeroImages, type PendingUpload, type UploadStatus } from './useHeroImages.ts';

interface Props {
  /** Devuelve true si el error era una sesión vencida (y ya se manejó). */
  onError: (error: unknown) => boolean;
}

const UPLOAD_BADGES: Record<UploadStatus, { text: string; tone?: 'error' }> = {
  queued: { text: 'En cola' },
  uploading: { text: 'Subiendo…' },
  uploaded: { text: 'Sin guardar' },
  failed: { text: 'Error', tone: 'error' },
};

const DELETE_QUESTION = '¿Eliminar esta foto del hero? Deja de aparecer en la home.';

/**
 * Fotos del hero (S3, S4): subir varias a la vez, describir cada una (texto alternativo y crédito),
 * editarlas y borrarlas. Cada foto se guarda por separado, fuera del formulario de ajustes.
 */
export function HeroGallery({ onError }: Props) {
  const gallery = useHeroImages(onError);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const renderPending = (upload: PendingUpload) => (
    <li key={upload.key}>
      <HeroImageCard
        title={upload.fileName}
        badge={UPLOAD_BADGES[upload.status]}
        thumbnail={<ImagePreview src={upload.previewUrl} alt="Vista previa" emptyText="Sin vista previa" />}
        canSave={upload.status === 'uploaded'}
        error={upload.error}
        saveLabel="Guardar"
        onSave={(input) => gallery.savePending(upload, input)}
        remove={{ label: 'Descartar', tone: 'ghost', onClick: () => gallery.discardPending(upload) }}
      />
    </li>
  );

  return (
    <section className="settings-section" aria-labelledby="settings-hero">
      <div className="section-head">
        <h2 id="settings-hero">Fotos del hero</h2>
        <p className="section-note">
          La home muestra una al azar en cada visita, nunca la misma dos veces seguidas. Cada cambio regenera el sitio.
        </p>
      </div>

      <div className="hero-upload">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Subir fotos
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            gallery.addFiles(Array.from(event.target.files ?? []));
            event.target.value = ''; // permite volver a elegir los mismos archivos
          }}
        />
        <p className="help">
          Podés elegir varias a la vez. Mejor horizontales y grandes (2400 px de ancho o más): se optimizan al subir. Cada
          una necesita su texto alternativo antes de guardarla.
        </p>
      </div>

      <p className="field-status" role="status" aria-live="polite">
        {gallery.notice}
      </p>

      {gallery.pending.length > 0 && (
        <ul className="hero-list" aria-label="Fotos por guardar">
          {gallery.pending.map(renderPending)}
        </ul>
      )}

      {gallery.loading ? (
        <p className="help">Cargando fotos…</p>
      ) : gallery.loadError ? (
        <p className="banner banner-error" role="alert">
          {gallery.loadError}
        </p>
      ) : gallery.images.length === 0 ? (
        <p className="help hero-empty">
          Todavía no hay fotos: la home usa la foto por defecto del sitio si existe; si no, un hero tipográfico oscuro.
        </p>
      ) : (
        <ol className="hero-list" aria-label="Fotos guardadas">
          {gallery.images.map((image, index) => (
            <li key={image.id}>
              <HeroImageCard
                title={`Foto ${index + 1}`}
                thumbnail={
                  <ImagePreview
                    src={thumbnailUrl(image.media)}
                    alt={image.alt}
                    emptyText="Sin vista previa"
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
                  onClick: () => (window.confirm(DELETE_QUESTION) ? gallery.deleteImage(image.id) : undefined),
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

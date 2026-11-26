import { useId, useRef, useState, type ReactNode } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { IMAGE_ACCEPT } from '../media.ts';
import { isImageUrl } from '../settings/validate.ts';
import { ImagePreview } from './ImagePreview.tsx';

interface Props {
  legend: string;
  url: string;
  alt: string;
  onUrlChange: (url: string) => void;
  onAltChange: (alt: string) => void;
  /** Sube el archivo (POST /api/admin/media) y devuelve la URL /media/... */
  onUpload: (file: File) => Promise<string>;
  /** Error de validación de la URL (cliente o API). */
  error?: string | undefined;
  /** Error del texto alternativo. */
  altError?: string | undefined;
  /** Explicación debajo del bloque. */
  help?: ReactNode;
}

/**
 * Bloque de imagen reutilizable (portada del post): subir un archivo o pegar una URL,
 * texto alternativo, miniatura y botón para quitarla.
 */
export function ImageField({ legend, url, alt, onUrlChange, onAltChange, onUpload, error, altError, help }: Props) {
  const { t } = useUiLanguage();
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const trimmed = url.trim();
  const canPreview = trimmed !== '' && isImageUrl(trimmed);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setStatus(t('upload.progress', { name: file.name }));
    try {
      onUrlChange(await onUpload(file));
      setStatus(alt.trim() === '' ? t('image.uploadedDescribe') : t('image.uploaded'));
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : t('error.unknown');
      setStatus(t('upload.failed', { name: file.name, error }));
    } finally {
      setUploading(false);
    }
  };

  const describedBy = [error ? `${id}-url-error` : null, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset className="image-field">
      <legend className="label">{legend}</legend>

      <div className="image-field-grid">
        <ImagePreview
          src={canPreview ? trimmed : null}
          alt={alt.trim() || t('common.preview')}
          emptyText={trimmed === '' ? t('image.none') : t('image.invalidUrl')}
        />

        <div className="image-field-controls">
          <div className="actions">
            <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? t('common.uploading') : t('image.upload')}
            </button>
            {trimmed !== '' && (
              <button
                type="button"
                className="ghost"
                disabled={uploading}
                onClick={() => {
                  onUrlChange('');
                  onAltChange('');
                  setStatus(t('image.removed'));
                }}
              >
                {t('image.remove')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = ''; // permite volver a elegir el mismo archivo
              }}
            />
          </div>

          <label className="field">
            <span className="label">{t('image.url')}</span>
            <input
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder={t('image.urlPlaceholder')}
              inputMode="url"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
            />
          </label>
          {error && (
            <p id={`${id}-url-error`} className="field-error">
              {error}
            </p>
          )}

          <label className="field">
            <span className="label">{t('image.alt')}</span>
            <input
              value={alt}
              onChange={(event) => onAltChange(event.target.value)}
              placeholder={t('image.altPlaceholder')}
              maxLength={300}
              aria-invalid={altError ? true : undefined}
            />
          </label>
          {altError && <p className="field-error">{altError}</p>}

          <p className="field-status" role="status" aria-live="polite">
            {status}
          </p>
        </div>
      </div>

      {help && (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
    </fieldset>
  );
}

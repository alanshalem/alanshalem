import { useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/problem.ts';
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
  /** Cap of the alt text: the one of the content that holds the image (LIMITS, same as the API). */
  altMaxLength: number;
  /** Uploads the file (POST /api/admin/media) and returns the /media/... URL */
  onUpload: (file: File) => Promise<string>;
  /** URL validation error (client or API). */
  error?: string | undefined;
  /** Explanation below the block. */
  help?: ReactNode;
}

/**
 * Reusable image block (post cover): upload a file or paste a URL, alt text, thumbnail and a button to remove it.
 */
export function ImageField({ legend, url, alt, onUrlChange, onAltChange, altMaxLength, onUpload, error, help }: Props) {
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
      setStatus(t('upload.failed', { name: file.name, error: errorMessage(caught, t('error.unknown')) }));
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
                event.target.value = ''; // allows choosing the same file again
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
              maxLength={altMaxLength}
            />
          </label>

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

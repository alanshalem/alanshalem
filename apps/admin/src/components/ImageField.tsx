import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isImageUrl } from '../settings/validate.ts';

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
  /** Campos extra (p. ej. el crédito de la foto del hero). */
  children?: ReactNode;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/**
 * Bloque de imagen reutilizable (portada del post, foto del hero): subir un archivo o pegar una URL,
 * texto alternativo, miniatura y botón para quitarla.
 */
export function ImageField({ legend, url, alt, onUrlChange, onAltChange, onUpload, error, altError, help, children }: Props) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  const trimmed = url.trim();
  const canPreview = trimmed !== '' && isImageUrl(trimmed);

  // Una URL nueva merece otro intento de vista previa.
  useEffect(() => setBroken(false), [trimmed]);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setStatus(`Subiendo ${file.name}…`);
    try {
      onUrlChange(await onUpload(file));
      setStatus(alt.trim() === '' ? 'Imagen subida. Describila en el texto alternativo.' : 'Imagen subida.');
    } catch (caught) {
      setStatus(`No se pudo subir ${file.name}: ${caught instanceof Error ? caught.message : 'error desconocido'}`);
    } finally {
      setUploading(false);
    }
  };

  const describedBy = [error ? `${id}-url-error` : null, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset className="image-field">
      <legend className="label">{legend}</legend>

      <div className="image-field-grid">
        <div className="image-field-preview">
          {canPreview && !broken ? (
            <img src={trimmed} alt={alt.trim() || 'Vista previa'} onError={() => setBroken(true)} />
          ) : (
            <span className="image-field-empty">
              {trimmed === '' ? 'Sin imagen' : broken ? 'No se pudo cargar la vista previa' : 'URL no válida'}
            </span>
          )}
        </div>

        <div className="image-field-controls">
          <div className="actions">
            <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? 'Subiendo…' : 'Subir imagen'}
            </button>
            {trimmed !== '' && (
              <button
                type="button"
                className="ghost"
                disabled={uploading}
                onClick={() => {
                  onUrlChange('');
                  onAltChange('');
                  setStatus('Imagen quitada.');
                }}
              >
                Quitar
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = ''; // permite volver a elegir el mismo archivo
              }}
            />
          </div>

          <label className="field">
            <span className="label">URL de la imagen</span>
            <input
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="/media/… o https://…"
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
            <span className="label">Texto alternativo</span>
            <input
              value={alt}
              onChange={(event) => onAltChange(event.target.value)}
              placeholder="Qué se ve en la imagen"
              maxLength={300}
              aria-invalid={altError ? true : undefined}
            />
          </label>
          {altError && <p className="field-error">{altError}</p>}

          {children}

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

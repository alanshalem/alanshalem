import { useEffect, useState, type CSSProperties } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion.ts';

interface Props {
  /** `null` = no hay nada que mostrar todavía (se ve `emptyText`). */
  src: string | null;
  alt: string;
  emptyText: string;
  /** Color dominante del asset: fondo mientras baja la imagen. */
  color?: string | undefined;
  /** Miniatura borrosa en data URI (la genera la API al subir): fondo mientras baja la imagen. */
  placeholder?: string | undefined;
  /**
   * Video corto que se reproduce mudo y en bucle sobre `src` (que pasa a ser su póster). Con "reducir movimiento" no
   * arranca solo: muestra el póster y los controles del navegador para reproducirlo (WCAG 2.2.2).
   */
  video?: string | null | undefined;
}

// Solo data URIs de imagen en base64: el valor va dentro de url("…") y no debe poder cortar la declaración CSS.
const SAFE_PLACEHOLDER = /^data:image\/[a-z]+;base64,[a-z0-9+/=]+$/i;

/** Miniatura con fondo de espera y aviso si la imagen o el video no cargan (portada, ítems del hero). */
export function ImagePreview({ src, alt, emptyText, color, placeholder, video }: Props) {
  const { t } = useUiLanguage();
  const [broken, setBroken] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Una imagen nueva merece otro intento de vista previa.
  useEffect(() => setBroken(false), [src, video]);

  const background: CSSProperties = {
    backgroundColor: color,
    backgroundImage: placeholder && SAFE_PLACEHOLDER.test(placeholder) ? `url("${placeholder}")` : undefined,
  };

  return (
    <div className="image-field-preview" style={background}>
      {video && !broken ? (
        // Mudo y en línea: es lo que permite el autoplay, igual que en la home. `key`: cambiar `autoPlay` en un video
        // ya montado no lo frena; montarlo de nuevo sí.
        <video
          key={String(reducedMotion)}
          src={video}
          poster={src ?? undefined}
          aria-label={alt}
          muted
          loop
          playsInline
          autoPlay={!reducedMotion}
          controls={reducedMotion}
          onError={() => setBroken(true)}
        />
      ) : src && !broken ? (
        <img src={src} alt={alt} decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="image-field-empty">{broken ? t('image.previewFailed') : emptyText}</span>
      )}
    </div>
  );
}

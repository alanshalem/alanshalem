import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  /** `null` = no hay nada que mostrar todavía (se ve `emptyText`). */
  src: string | null;
  alt: string;
  emptyText: string;
  /** Color dominante del asset: fondo mientras baja la imagen. */
  color?: string | undefined;
  /** Miniatura borrosa en data URI (la genera la API al subir): fondo mientras baja la imagen. */
  placeholder?: string | undefined;
}

// Solo data URIs de imagen en base64: el valor va dentro de url("…") y no debe poder cortar la declaración CSS.
const SAFE_PLACEHOLDER = /^data:image\/[a-z]+;base64,[a-z0-9+/=]+$/i;

/** Miniatura con fondo de espera y aviso si la imagen no carga (portada, foto del hero, galería). */
export function ImagePreview({ src, alt, emptyText, color, placeholder }: Props) {
  const [broken, setBroken] = useState(false);

  // Una imagen nueva merece otro intento de vista previa.
  useEffect(() => setBroken(false), [src]);

  const background: CSSProperties = {
    backgroundColor: color,
    backgroundImage: placeholder && SAFE_PLACEHOLDER.test(placeholder) ? `url("${placeholder}")` : undefined,
  };

  return (
    <div className="image-field-preview" style={background}>
      {src && !broken ? (
        <img src={src} alt={alt} decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="image-field-empty">{broken ? 'No se pudo cargar la vista previa' : emptyText}</span>
      )}
    </div>
  );
}

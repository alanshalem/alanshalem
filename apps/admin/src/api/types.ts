export type PostStatus = 'draft' | 'published';

/** Fila de la lista de posts (sin el cuerpo, para que la lista sea liviana). */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  updatedAt: string;
  publishedAt: string | null;
  /** Portada opcional: ruta `/media/...` (subida) o URL `http(s)`. */
  coverUrl: string | null;
  coverAlt: string | null;
}

export interface Post extends PostSummary {
  summary: string;
  body: string;
  tags: string[];
  lang: string;
  createdAt: string;
}

/**
 * Lo que el editor envía al guardar. `slug` vacío = que la API lo genere desde el título.
 * Sin portada (`coverUrl: null`) el sitio usa la primera imagen del texto o, si no hay, una portada generativa.
 */
export interface PostInput {
  title: string;
  slug: string;
  summary: string;
  body: string;
  tags: string[];
  coverUrl: string | null;
  coverAlt: string | null;
}

/**
 * Datos del autor y del sitio (una sola fila en la API). Todo opcional salvo `name`;
 * los vacíos viajan como `null`. El mismo objeto sirve para el GET y para el PUT.
 */
export interface SiteSettings {
  name: string;
  /** Frase corta para `<meta name="description">`. */
  tagline: string | null;
  /** Markdown corto; el sitio lo renderiza con @blog/markdown. */
  bio: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

/** Una versión optimizada de una imagen subida (L10: AVIF y WebP en varios anchos). */
export interface MediaVariant {
  format: 'avif' | 'webp';
  width: number;
  url: string;
}

/** `MediaAssetDto`: lo que devuelve `POST /api/admin/media`. */
export interface MediaAsset {
  id: string;
  /** WebP del mayor ancho ≤ 1600: la URL que usan el Markdown y las portadas. */
  url: string;
  width: number;
  height: number;
  /** Color dominante `#rrggbb`. */
  color: string;
  /** Miniatura borrosa de ~16 px en data URI, para mostrar mientras carga la imagen real. */
  placeholder: string;
  variants: MediaVariant[];
  createdAt: string;
}

export type VideoStatus = 'processing' | 'ready' | 'failed';

/** Una versión del video ya procesada (L13: AV1 y H.264, 720p y 1080p, sin audio). */
export interface VideoSource {
  codec: 'av1' | 'h264';
  height: 720 | 1080;
  url: string;
  bytes: number;
}

/**
 * `VideoAssetDto`: lo que devuelven `POST /api/admin/media/videos` (202, en `processing`) y
 * `GET /api/admin/media/videos/{id}`. El proceso corre en segundo plano: hay que consultar hasta `ready` o `failed`.
 */
export interface VideoAsset {
  id: string;
  status: VideoStatus;
  error: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  /** Primer cuadro útil, optimizado como cualquier foto; `null` mientras procesa. */
  poster: MediaAsset | null;
  sources: VideoSource[];
  /** Avisos que no impiden usarlo (por ejemplo, más chico que lo ideal). */
  warnings: string[];
  createdAt: string;
}

/** `HeroImageDto`: una foto o un video de la galería del hero (la home muestra uno al azar en cada visita). */
export interface HeroImage {
  id: string;
  /** La foto; si es un video, su póster. */
  media: MediaAsset;
  video: VideoAsset | null;
  alt: string;
  credit: string | null;
  createdAt: string;
}

/** A qué asset se asocia un ítem nuevo del hero: una foto subida o un video ya procesado (`ready`). */
export type HeroMediaRef = { mediaId: string } | { videoId: string };

/** Lo que se edita de un ítem del hero (cuerpo del PUT; el POST agrega el `HeroMediaRef`). */
export interface HeroImageInput {
  alt: string;
  credit: string | null;
}

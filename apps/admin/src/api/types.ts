import type { Lang } from '../languages.ts';
import type { LIMITS } from '../limits.ts';

export type PostStatus = 'draft' | 'published';

/** Otra versión del mismo post en otro idioma (L4: `translations` de `PostDto` y `PostSummaryDto`). */
export interface PostTranslation {
  id: string;
  lang: Lang;
  slug: string;
  status: PostStatus;
  updatedAt: string;
  /** Último cambio de su contenido; publicar, despublicar o programar no lo mueven (ver `PostSummary`). */
  contentUpdatedAt: string;
}

/** Fila de la lista de posts (sin el cuerpo, para que la lista sea liviana). */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  /** Último cambio de cualquier tipo, también de estado: ordena y fecha la lista. */
  updatedAt: string;
  /**
   * Último cambio del contenido (la creación incluida). Es la fecha que dice si una traducción quedó atrás: publicar
   * el original no le deja nada nuevo que traducir (multiidioma L9).
   */
  contentUpdatedAt: string;
  publishedAt: string | null;
  /** Cuándo lo publica solo el servidor (UTC); solo en borradores: publicar o cancelar lo borra. */
  scheduledAt: string | null;
  /** Portada opcional: ruta `/media/...` (subida) o URL `http(s)`. */
  coverUrl: string | null;
  coverAlt: string | null;
  lang: Lang;
  /** Las versiones de un mismo post en distintos idiomas comparten grupo (a lo sumo una por idioma). */
  translationGroupId: string;
  /** Las otras versiones del grupo; vacío si no hay. */
  translations: PostTranslation[];
}

export interface Post extends PostSummary {
  summary: string;
  body: string;
  tags: string[];
  createdAt: string;
}

/**
 * Lo que el editor envía al guardar. `slug` vacío = que la API lo genere desde el título. El idioma no está acá:
 * se elige solo al crear (`api.createPost`) y después no cambia (L4).
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

/** Una versión en la lista del historial (`PostRevisionSummaryDto`): sin el cuerpo, que se pide al abrirla. */
export interface PostRevisionSummary {
  id: string;
  /** 1, 2, 3…: el orden de guardado (la lista llega de la más nueva a la más vieja). */
  number: number;
  createdAt: string;
  title: string;
  /** Caracteres del cuerpo: una pista del tamaño sin traerlo. */
  bodyLength: number;
}

/** Una versión completa (`PostRevisionDto`): la instantánea del contenido, con la misma forma que lo que se guarda. */
export interface PostRevision extends PostInput {
  id: string;
  number: number;
  createdAt: string;
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
  /** Versiones en inglés de `tagline` y `bio`; `null` = el sitio en inglés usa las de español (L3, L6). El nombre es uno solo (L12). */
  taglineEn: string | null;
  bioEn: string | null;
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

/** Cómo empalma el video al repetirse en el hero (L19). */
export type VideoFade = 'loop' | 'black' | 'none';

/** Las duraciones que acepta la API (VideoEdit.FadeDurations), desde src/limits.ts. */
export type FadeSeconds = (typeof LIMITS.video.fadeSeconds)[number];

/**
 * Recorte y fundido que aplica la API al procesar (L19): los campos multipart de la subida y el `edit` del
 * `VideoAssetDto`. Segundos del archivo original.
 */
export interface VideoEdit {
  trimStart: number;
  trimEnd: number;
  fade: VideoFade;
  /** Se envía también con `fade: 'none'` (la API lo ignora): así la elección no se pierde al cambiar de fundido. */
  fadeSeconds: FadeSeconds;
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
  /** La duración final (ya recortada). */
  durationSeconds: number;
  edit: VideoEdit;
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
  /** Versión en inglés de `alt`; `null` = el sitio en inglés usa la de español (L3). El crédito es uno solo (L13). */
  altEn: string | null;
  createdAt: string;
}

/** A qué asset se asocia un ítem nuevo del hero: una foto subida o un video ya procesado (`ready`). */
export type HeroMediaRef = { mediaId: string } | { videoId: string };

/** Lo que se edita de un ítem del hero (cuerpo del PUT; el POST agrega el `HeroMediaRef`). */
export interface HeroImageInput {
  alt: string;
  credit: string | null;
  altEn: string | null;
}

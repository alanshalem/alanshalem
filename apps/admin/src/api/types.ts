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

/** `HeroImageDto`: una foto de la galería del hero (la home muestra una al azar en cada visita). */
export interface HeroImage {
  id: string;
  media: MediaAsset;
  alt: string;
  credit: string | null;
  createdAt: string;
}

/** Lo que se edita de una foto del hero (cuerpo del PUT; el POST agrega `mediaId`). */
export interface HeroImageInput {
  alt: string;
  credit: string | null;
}

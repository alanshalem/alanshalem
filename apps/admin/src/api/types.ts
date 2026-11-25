export type PostStatus = 'draft' | 'published';

/** Fila de la lista de posts (sin el cuerpo, para que la lista sea liviana). */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  updatedAt: string;
  publishedAt: string | null;
}

export interface Post extends PostSummary {
  summary: string;
  body: string;
  tags: string[];
  lang: string;
  createdAt: string;
}

/** Lo que el editor envía al guardar. `slug` vacío = que la API lo genere desde el título. */
export interface PostInput {
  title: string;
  slug: string;
  summary: string;
  body: string;
  tags: string[];
}

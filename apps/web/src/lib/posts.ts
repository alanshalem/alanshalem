import { excerpt, readingTimeMinutes, renderMarkdown, slugify, type Heading } from '@blog/markdown';

/** Forma en que la API entrega un post publicado (GET /api/internal/posts). */
interface ApiPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  lang: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface Tag {
  name: string;
  slug: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  /** Texto corto para listados y <meta description>. */
  description: string;
  tags: Tag[];
  publishedAt: Date;
  updatedAt: Date;
  readingMinutes: number;
  /** HTML ya renderizado y escapado por @blog/markdown. */
  html: string;
  headings: Heading[];
}

/** Ruta pública de un post. Única fuente de verdad para no repetir el prefijo en cada página. */
export const postPath = (post: Pick<BlogPost, 'slug'>): string => `/articulos/${post.slug}/`;
export const tagPath = (tag: Pick<Tag, 'slug'>): string => `/temas/${tag.slug}/`;

function toBlogPost(apiPost: ApiPost): BlogPost {
  // En el sitio, el título del post es el <h1>: el "#" del cuerpo pasa a <h2> (headingOffset: 1).
  const { html, headings } = renderMarkdown(apiPost.body, { headingOffset: 1 });
  return {
    slug: apiPost.slug,
    title: apiPost.title,
    description: apiPost.summary || excerpt(apiPost.body, 160),
    tags: apiPost.tags.map((name) => ({ name, slug: slugify(name) })),
    publishedAt: new Date(apiPost.publishedAt ?? apiPost.createdAt),
    updatedAt: new Date(apiPost.updatedAt),
    readingMinutes: readingTimeMinutes(apiPost.body),
    html,
    headings,
  };
}

async function loadPosts(): Promise<BlogPost[]> {
  const apiUrl = process.env.API_URL;
  const token = process.env.BUILDER_TOKEN;
  if (!apiUrl || !token) {
    throw new Error('Faltan las variables API_URL y BUILDER_TOKEN para leer los posts durante el build.');
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/internal/posts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Si la API falla, el build debe fallar: el builder conserva la versión anterior del sitio en vez de publicar una vacía.
  if (!response.ok) {
    throw new Error(`La API respondió ${response.status} al pedir los posts publicados.`);
  }

  const apiPosts = (await response.json()) as ApiPost[];
  return apiPosts
    .map(toBlogPost)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

// Astro ejecuta cada página en el mismo proceso: la lista se pide una sola vez por build.
let cache: Promise<BlogPost[]> | undefined;

/** Todos los posts publicados, más nuevos primero. */
export function getPosts(): Promise<BlogPost[]> {
  return (cache ??= loadPosts());
}

/** Etiquetas con sus posts, ordenadas por cantidad de posts. */
export async function getTags(): Promise<Array<{ tag: Tag; posts: BlogPost[] }>> {
  const byTag = new Map<string, { tag: Tag; posts: BlogPost[] }>();
  for (const post of await getPosts()) {
    for (const tag of post.tags) {
      const entry = byTag.get(tag.slug) ?? { tag, posts: [] };
      entry.posts.push(post);
      byTag.set(tag.slug, entry);
    }
  }
  return [...byTag.values()].sort((a, b) => b.posts.length - a.posts.length || a.tag.name.localeCompare(b.tag.name));
}

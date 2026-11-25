import { excerpt, readingTimeMinutes, renderMarkdown, slugify, type Heading } from '@blog/markdown';
import { getInternal, oncePerBuild } from './api.ts';
import { resolveCover, type Cover } from './cover.ts';

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
  /** Portada cargada en el admin (L4): ruta `/media/...` o URL http(s). */
  coverUrl?: string | null;
  coverAlt?: string | null;
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
  /** Portada efectiva (L5): coverUrl → primera imagen del Markdown → SVG generativo. */
  cover: Cover;
}

/** Ruta pública de un post. Única fuente de verdad para no repetir el prefijo en cada página. */
export const postPath = (post: Pick<BlogPost, 'slug'>): string => `/articulos/${post.slug}/`;
export const tagPath = (tag: Pick<Tag, 'slug'>): string => `/temas/${tag.slug}/`;

/** Las imágenes relativas del Markdown ("img/a.png") se resuelven contra la página del post. */
function rootRelative(cover: Cover, pagePath: string): Cover {
  if (cover.kind !== 'image' || /^([a-z][a-z0-9+.-]*:|\/)/i.test(cover.src)) return cover;
  const url = new URL(cover.src, `http://sitio${pagePath}`);
  return { ...cover, src: `${url.pathname}${url.search}${url.hash}` };
}

function toBlogPost(apiPost: ApiPost): BlogPost {
  // En el sitio, el título del post es el <h1>: el "#" del cuerpo pasa a <h2> (headingOffset: 1).
  const { html, headings } = renderMarkdown(apiPost.body, { headingOffset: 1 });
  const tags = apiPost.tags.map((name) => ({ name, slug: slugify(name) }));
  const cover = resolveCover({
    slug: apiPost.slug,
    tag: tags[0]?.slug,
    coverUrl: apiPost.coverUrl,
    coverAlt: apiPost.coverAlt,
    html,
  });
  return {
    slug: apiPost.slug,
    title: apiPost.title,
    description: apiPost.summary || excerpt(apiPost.body, 160),
    tags,
    publishedAt: new Date(apiPost.publishedAt ?? apiPost.createdAt),
    updatedAt: new Date(apiPost.updatedAt),
    readingMinutes: readingTimeMinutes(apiPost.body),
    html,
    headings,
    cover: rootRelative(cover, postPath(apiPost)),
  };
}

async function loadPosts(): Promise<BlogPost[]> {
  const apiPosts = await getInternal<ApiPost[]>('/api/internal/posts', 'los posts publicados');
  return apiPosts
    .map(toBlogPost)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/** Todos los posts publicados, más nuevos primero. */
export const getPosts: () => Promise<BlogPost[]> = oncePerBuild(loadPosts);

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

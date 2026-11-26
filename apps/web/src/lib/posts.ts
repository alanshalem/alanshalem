import { excerpt, POST_BODY_RENDER_OPTIONS, readingTimeMinutes, renderMarkdown, slugify, type Heading } from '@blog/markdown';
import { getInternal, oncePerBuild } from './api.ts';
import { resolveCover, type Cover } from './cover.ts';
import { isLang, paths, type Alternates, type Lang } from './i18n.ts';

/** Forma en que la API entrega un post publicado (GET /api/internal/posts, L4). */
export interface ApiPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  lang: string;
  /** Une las versiones en otros idiomas del mismo post (L4). Opcional solo mientras la API no lo mande (T1). */
  translationGroupId?: string;
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
  lang: Lang;
  translationGroupId: string;
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

/** El índice lateral lista secciones (h2) y subsecciones (h3): más profundidad ensucia más de lo que ayuda. */
const TOC_MAX_LEVEL = 3;

/** Los títulos del cuerpo que entran al índice lateral, en orden. */
export const tocEntries = (headings: readonly Heading[]): Heading[] => headings.filter((heading) => heading.level <= TOC_MAX_LEVEL);

/** Ruta pública de un post: su idioma define el prefijo y el segmento (/es/articulos/, /en/articles/). */
export const postPath = (post: Pick<BlogPost, 'lang' | 'slug'>): string => paths.post(post.lang, post.slug);

/** Las imágenes relativas del Markdown ("img/a.png") se resuelven contra la página del post. */
function rootRelative(cover: Cover, pagePath: string): Cover {
  if (cover.kind !== 'image' || /^([a-z][a-z0-9+.-]*:|\/)/i.test(cover.src)) return cover;
  const url = new URL(cover.src, `http://sitio${pagePath}`);
  return { ...cover, src: `${url.pathname}${url.search}${url.hash}` };
}

export function toBlogPost(apiPost: ApiPost): BlogPost {
  const { lang } = apiPost;
  // Publicarlo bajo otro idioma lo mostraría con la interfaz equivocada: mejor que el build falle y quede el sitio anterior.
  if (!isLang(lang)) throw new Error(`El post "${apiPost.slug}" tiene un idioma "${lang}" que el sitio no publica.`);
  // Las mismas opciones que la vista previa del admin (@blog/markdown): "## sección, ### subsección" y el título del post
  // como único <h1>, figuras y tipografía inteligente; el idioma pone los títulos de cajas y notas en el del post.
  const { html, headings } = renderMarkdown(apiPost.body, { ...POST_BODY_RENDER_OPTIONS, lang });
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
    lang,
    // Sin grupo (API anterior a T1) cada post es su propio grupo: no tiene traducciones.
    translationGroupId: apiPost.translationGroupId ?? apiPost.id,
    title: apiPost.title,
    description: apiPost.summary || excerpt(apiPost.body, 160),
    tags,
    publishedAt: new Date(apiPost.publishedAt ?? apiPost.createdAt),
    updatedAt: new Date(apiPost.updatedAt),
    readingMinutes: readingTimeMinutes(apiPost.body),
    html,
    headings,
    cover: rootRelative(cover, paths.post(lang, apiPost.slug)),
  };
}

async function loadPosts(): Promise<BlogPost[]> {
  const apiPosts = await getInternal<ApiPost[]>('/api/internal/posts', 'los posts publicados');
  return apiPosts
    .map(toBlogPost)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/** Todos los posts publicados de todos los idiomas, más nuevos primero. */
export const getPosts: () => Promise<BlogPost[]> = oncePerBuild(loadPosts);

/** Los posts de un idioma, en el mismo orden. */
export const postsIn = (posts: readonly BlogPost[], lang: Lang): BlogPost[] => posts.filter((post) => post.lang === lang);

export interface TagEntry {
  tag: Tag;
  posts: BlogPost[];
}

/**
 * Temas de esos posts con sus posts, por cantidad y después por nombre. Se llama con los posts de un idioma:
 * cada idioma tiene sus propios temas (los tags se escriben por versión y no se traducen uno a uno).
 */
export function tagsOf(posts: readonly BlogPost[]): TagEntry[] {
  const byTag = new Map<string, TagEntry>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const entry = byTag.get(tag.slug) ?? { tag, posts: [] };
      entry.posts.push(post);
      byTag.set(tag.slug, entry);
    }
  }
  return [...byTag.values()].sort((a, b) => b.posts.length - a.posts.length || a.tag.name.localeCompare(b.tag.name));
}

/**
 * translationGroupId → ruta de la versión publicada en cada idioma (L3). `posts` son solo los publicados, así que
 * un borrador nunca aparece como alternativa.
 */
export function alternatesByGroup(posts: readonly BlogPost[]): Map<string, Alternates> {
  const groups = new Map<string, Alternates>();
  for (const post of posts) {
    groups.set(post.translationGroupId, { ...groups.get(post.translationGroupId), [post.lang]: postPath(post) });
  }
  return groups;
}

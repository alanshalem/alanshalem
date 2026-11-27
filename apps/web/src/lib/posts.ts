import { excerpt, POST_BODY_RENDER_OPTIONS, readingTimeOfText, renderMarkdown, slugify, type Heading } from '@blog/markdown';
import { getInternal, oncePerBuild } from './api.ts';
import { resolveCover, type Cover } from './cover.ts';
import { isLang, paths, type Alternates, type Lang } from './i18n.ts';
import { yearOf } from './site.ts';

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
  // One render feeds the page: its `text` is what the reader sees (figure captions, callout titles in the post's
  // language), so the reading time matches the admin preview, which counts the same render.
  const { html, headings, text } = renderMarkdown(apiPost.body, { ...POST_BODY_RENDER_OPTIONS, lang });
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
    readingMinutes: readingTimeOfText(text),
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

/** "Keep reading" under a post: how many of the newest posts of its language it suggests. */
const READ_NEXT_COUNT = 3;

/** The newest posts in the same language as `post`, without `post` itself (newest first, like `posts`). */
export const readNextFor = (posts: readonly BlogPost[], post: Pick<BlogPost, 'lang' | 'slug'>): BlogPost[] =>
  postsIn(posts, post.lang)
    .filter((other) => other.slug !== post.slug)
    .slice(0, READ_NEXT_COUNT);

export interface YearGroup {
  year: number;
  posts: BlogPost[];
}

/** The archive by year (in the site time zone), keeping the order of `posts` (newest first) in and across years. */
export function postsByYear(posts: readonly BlogPost[]): YearGroup[] {
  const byYear = new Map<number, BlogPost[]>();
  for (const post of posts) {
    const year = yearOf(post.publishedAt);
    const group = byYear.get(year);
    if (group) group.push(post);
    else byYear.set(year, [post]);
  }
  return [...byYear].map(([year, inYear]) => ({ year, posts: inYear }));
}

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

/** How many posts and topics each section of the home shows. */
const HOME_LATEST_COUNT = 3;
const HOME_MORE_COUNT = 4;
const HOME_TOPICS_COUNT = 8;

export interface HomeSections {
  /** The newest post, shown large; undefined when nothing is published yet. */
  featured: BlogPost | undefined;
  /** The next ones, as a row of cards. */
  latest: BlogPost[];
  /** The ones after those, as a numbered list. */
  more: BlogPost[];
  /** The topics with the most posts. */
  topics: TagEntry[];
}

/** What the home shows from the posts of its language (newest first): each post appears in one section only. */
export function homeSections(posts: readonly BlogPost[]): HomeSections {
  const [featured, ...rest] = posts;
  return {
    featured,
    latest: rest.slice(0, HOME_LATEST_COUNT),
    more: rest.slice(HOME_LATEST_COUNT, HOME_LATEST_COUNT + HOME_MORE_COUNT),
    topics: tagsOf(posts).slice(0, HOME_TOPICS_COUNT),
  };
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

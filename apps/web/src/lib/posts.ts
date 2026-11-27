import { excerpt, readingTimeOfText, renderMarkdown, slugify, type Heading } from '@blog/markdown';
import { postBodyOptions } from '@blog/math';
import { getInternal, oncePerBuild } from './api.ts';
import { resolveCover, type Cover } from './cover.ts';
import { isLang, paths, type Alternates, type Lang } from './i18n.ts';
import { yearOf } from './site.ts';

/** How the API delivers a published post (GET /api/internal/posts). */
export interface ApiPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  lang: string;
  /** Links the versions of the same post in other languages. Optional only for an API that does not send it yet. */
  translationGroupId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Cover set in the admin: a `/media/...` path or an http(s) URL. */
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
  /** Short text for listings and <meta description>. */
  description: string;
  tags: Tag[];
  publishedAt: Date;
  updatedAt: Date;
  readingMinutes: number;
  /** HTML already rendered and escaped by @blog/markdown. */
  html: string;
  headings: Heading[];
  /** Effective cover: coverUrl → first Markdown image → generative SVG. */
  cover: Cover;
}

/** The side table of contents lists sections (h2) and subsections (h3): more depth clutters more than it helps. */
const TOC_MAX_LEVEL = 3;

/** The body headings that go into the side table of contents, in order. */
export const tocEntries = (headings: readonly Heading[]): Heading[] => headings.filter((heading) => heading.level <= TOC_MAX_LEVEL);

/** A post's public route: its language sets the prefix and the segment (/es/articulos/, /en/articles/). */
export const postPath = (post: Pick<BlogPost, 'lang' | 'slug'>): string => paths.post(post.lang, post.slug);

/** Relative Markdown images ("img/a.png") are resolved against the post's page. */
function rootRelative(cover: Cover, pagePath: string): Cover {
  if (cover.kind !== 'image' || /^([a-z][a-z0-9+.-]*:|\/)/i.test(cover.src)) return cover;
  const url = new URL(cover.src, `http://site${pagePath}`);
  return { ...cover, src: `${url.pathname}${url.search}${url.hash}` };
}

export function toBlogPost(apiPost: ApiPost): BlogPost {
  const { lang } = apiPost;
  // Publishing it under another language would show it with the wrong UI: better to fail the build and keep the
  // previous site.
  if (!isLang(lang)) throw new Error(`Post "${apiPost.slug}" has language "${lang}", which the site does not publish.`);
  // The same options as the admin preview (`postBodyOptions` of @blog/math): "## section, ### subsection" with the post
  // title as the only <h1>, figures, smart typography and TeX math as MathML; the language puts callout and footnote
  // titles in the post's language.
  // One render feeds the page: its `text` is what the reader sees (figure captions, callout titles in the post's
  // language), so the reading time matches the admin preview, which counts the same render.
  const { html, headings, text } = renderMarkdown(apiPost.body, postBodyOptions(lang));
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
    // Without a group (an API that does not send it yet) each post is its own group: it has no translations.
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
  const apiPosts = await getInternal<ApiPost[]>('/api/internal/posts', 'the published posts');
  return apiPosts
    .map(toBlogPost)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/** Every published post in every language, newest first. */
export const getPosts: () => Promise<BlogPost[]> = oncePerBuild(loadPosts);

/** The posts of one language, in the same order. */
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
 * The topics of those posts with their posts, by count and then by name. Called with the posts of one language:
 * each language has its own topics (tags are written per version and not translated one to one).
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
 * translationGroupId → route of the published version in each language. `posts` are only the published ones, so a
 * draft never shows up as an alternate.
 */
export function alternatesByGroup(posts: readonly BlogPost[]): Map<string, Alternates> {
  const groups = new Map<string, Alternates>();
  for (const post of posts) {
    groups.set(post.translationGroupId, { ...groups.get(post.translationGroupId), [post.lang]: postPath(post) });
  }
  return groups;
}

import type { APIRoute } from 'astro';
import { sitemapXml, type SitemapEntry } from '../lib/feeds.ts';
import { LANGS, alternatesFor, paths } from '../lib/i18n.ts';
import { alternatesByGroup, getPosts, postPath, postsIn, tagsOf } from '../lib/posts.ts';
import { site } from '../lib/site.ts';

/** Todas las páginas de los dos idiomas; las que tienen versión en cada idioma llevan sus alternates hreflang. */
export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const groups = alternatesByGroup(posts);

  const entries: SitemapEntry[] = LANGS.flatMap((lang) => {
    const own = postsIn(posts, lang);
    const lastmod = own[0]?.updatedAt;
    return [
      { path: paths.home(lang), lastmod, alternates: alternatesFor(paths.home) },
      { path: paths.posts(lang), lastmod, alternates: alternatesFor(paths.posts) },
      { path: paths.tags(lang), alternates: alternatesFor(paths.tags) },
      ...own.map((post) => ({ path: postPath(post), lastmod: post.updatedAt, alternates: groups.get(post.translationGroupId) })),
      ...tagsOf(own).map(({ tag }) => ({ path: paths.tag(lang, tag.slug) })),
    ];
  });

  return new Response(sitemapXml(entries, site.url), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

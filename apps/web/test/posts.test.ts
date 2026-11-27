import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as postsModule from '../src/lib/posts.ts';
import { alternatesByGroup, postPath, postsIn, tagsOf, toBlogPost, type ApiPost } from '../src/lib/posts.ts';

const apiPost = (overrides: Partial<ApiPost> = {}): ApiPost => ({
  id: 'p1',
  slug: 'hola',
  title: 'Hola',
  summary: 'Resumen',
  body: 'Cuerpo del post.',
  tags: ['.NET'],
  lang: 'es',
  translationGroupId: 'g1',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  publishedAt: '2026-11-01T12:00:00Z',
  ...overrides,
});

describe('toBlogPost: language and translation group', () => {
  it('keeps lang and translationGroupId; the route comes from the language', () => {
    const post = toBlogPost(apiPost({ lang: 'en', slug: 'hello', translationGroupId: 'g9' }));
    assert.equal(post.lang, 'en');
    assert.equal(post.translationGroupId, 'g9');
    assert.equal(postPath(post), '/en/articles/hello/');
  });
  it('without translationGroupId (an API that does not send it) each post is its own group', () => {
    const { translationGroupId, ...old } = apiPost({ id: 'solo' });
    assert.equal(translationGroupId, 'g1');
    assert.equal(toBlogPost(old).translationGroupId, 'solo');
  });
  it('an unknown language stops the build (it is not published under another language)', () => {
    assert.throws(() => toBlogPost(apiPost({ lang: 'fr' })), /language "fr"/);
  });
  it('relative Markdown images resolve against the post page in its language', () => {
    const post = toBlogPost(apiPost({ lang: 'en', slug: 'hello', body: '![x](img/a.png)' }));
    assert.equal(post.cover.kind === 'image' && post.cover.src, '/en/articles/hello/img/a.png');
  });
});

describe('toBlogPost: body Markdown extensions in the post language', () => {
  it('callouts are titled in the post language', () => {
    const callout = '> [!NOTE]\n> Text.';
    assert.match(toBlogPost(apiPost({ lang: 'en', body: callout })).html, /<p class="callout-title">Note<\/p>/);
    assert.match(toBlogPost(apiPost({ lang: 'es', body: callout })).html, /<p class="callout-title">Nota<\/p>/);
  });
  it('a lone image with a title is a figure with a caption, and still serves as the cover', () => {
    const post = toBlogPost(apiPost({ body: '![Faro](/media/faro.jpg "Faro de noche")' }));
    assert.match(post.html, /^<figure><img src="\/media\/faro\.jpg" alt="Faro"[^>]*><figcaption>Faro de noche<\/figcaption><\/figure>$/);
    assert.equal(post.cover.kind === 'image' && post.cover.src, '/media/faro.jpg');
  });
  it('smart typography: quotes, dashes and ellipses, never inside code', () => {
    const { html } = toBlogPost(apiPost({ lang: 'en', body: 'He said "wait" -- then... `a -- "b"`' }));
    assert.equal(html, '<p>He said “wait” – then… <code>a -- &quot;b&quot;</code></p>');
  });
  it('a body title still goes down one level (the <h1> is the post title)', () => {
    assert.match(toBlogPost(apiPost({ body: '# Uno' })).html, /^<h2 id="uno">Uno<\/h2>$/);
  });
});

describe('toBlogPost: standard body headings ("## section, ### subsection")', () => {
  const body = '# Intro\n\n## Sección\n\n### Subsección\n\n#### Detalle';

  it('## is h2, ### is h3 and a body # is a section (h2): the post title is the only h1', () => {
    const { html } = toBlogPost(apiPost({ body }));
    assert.equal(
      html,
      '<h2 id="intro">Intro</h2>\n<h2 id="seccion">Sección</h2>\n<h3 id="subseccion">Subsección</h3>\n<h4 id="detalle">Detalle</h4>',
    );
    assert.doesNotMatch(html, /<h1/);
  });

  it('the side table of contents lists sections (h2) and subsections (h3), nothing deeper', () => {
    const toc = postsModule.tocEntries(toBlogPost(apiPost({ body })).headings);
    assert.deepEqual(
      toc.map(({ level, id }) => [level, id]),
      [[2, 'intro'], [2, 'seccion'], [3, 'subseccion']],
    );
  });
});

describe('alternatesByGroup: the published versions of each group', () => {
  const es = toBlogPost(apiPost({ id: 'a', slug: 'hola', lang: 'es', translationGroupId: 'g1' }));
  const en = toBlogPost(apiPost({ id: 'b', slug: 'hello', lang: 'en', translationGroupId: 'g1' }));
  const solo = toBlogPost(apiPost({ id: 'c', slug: 'solo', lang: 'es', translationGroupId: 'g2' }));

  it('joins the versions by group, with the route of each language', () => {
    const map = alternatesByGroup([es, en, solo]);
    assert.deepEqual(map.get('g1'), { es: '/es/articulos/hola/', en: '/en/articles/hello/' });
    assert.deepEqual(map.get('g2'), { es: '/es/articulos/solo/' });
    assert.equal(map.size, 2);
  });
});

describe('posts and topics per language', () => {
  const es1 = toBlogPost(apiPost({ id: 'a', slug: 'a', lang: 'es', tags: ['Rendimiento', '.NET'] }));
  const es2 = toBlogPost(apiPost({ id: 'b', slug: 'b', lang: 'es', tags: ['.NET'] }));
  const en1 = toBlogPost(apiPost({ id: 'c', slug: 'c', lang: 'en', tags: ['Performance'] }));

  it('postsIn filters by language without changing the order', () => {
    assert.deepEqual(postsIn([es1, en1, es2], 'es').map((p) => p.slug), ['a', 'b']);
    assert.deepEqual(postsIn([es1, en1, es2], 'en').map((p) => p.slug), ['c']);
  });
  it('tagsOf: the topics of those posts, by count and then by name', () => {
    assert.deepEqual(
      tagsOf([es1, es2]).map(({ tag, posts }) => [tag.slug, posts.length]),
      [['net', 2], ['rendimiento', 1]],
    );
    assert.deepEqual(tagsOf([en1]).map(({ tag }) => tag.name), ['Performance']);
  });
});

describe('toBlogPost: reading time from the text the page shows (same as the admin preview)', () => {
  const words = (n: number): string => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');

  it('a figure caption is read on the page, so it counts toward the minutes', () => {
    // 200 words of prose + a 6-word caption: the page shows 206 words (2 min); the bare-options text had 200 (1 min).
    const body = `${words(200)}\n\n![Faro](/media/faro.jpg "Faro de noche en la costa")`;
    assert.equal(toBlogPost(apiPost({ body })).readingMinutes, 2);
  });

  it('plain prose keeps its count: 200 words is 1 min, 201 words is 2 min', () => {
    assert.equal(toBlogPost(apiPost({ body: words(200) })).readingMinutes, 1);
    assert.equal(toBlogPost(apiPost({ body: words(201) })).readingMinutes, 2);
  });

  it('the description still comes from the plain excerpt when there is no summary', () => {
    const post = toBlogPost(apiPost({ summary: '', lang: 'en', body: 'He said "wait" -- then.' }));
    assert.equal(post.description, 'He said "wait" -- then.');
  });
});

describe('postsByYear: archive grouped by year in the site time zone', () => {
  const at = (slug: string, publishedAt: string) => toBlogPost(apiPost({ id: slug, slug, publishedAt }));

  it('keeps the incoming order inside each year and the years in first-seen order', () => {
    const posts = [at('c', '2027-03-01T12:00:00Z'), at('b', '2026-06-01T12:00:00Z'), at('a', '2026-02-01T12:00:00Z')];
    assert.deepEqual(
      postsModule.postsByYear(posts).map(({ year, posts: inYear }) => [year, inYear.map((p) => p.slug)]),
      [[2027, ['c']], [2026, ['b', 'a']]],
    );
  });

  it('a post published on New Year’s Eve night in Buenos Aires belongs to the old year', () => {
    // 2027-01-01 02:30 UTC = 2026-12-31 23:30 in America/Argentina/Buenos_Aires.
    assert.deepEqual(postsModule.postsByYear([at('x', '2027-01-01T02:30:00Z')]).map(({ year }) => year), [2026]);
  });

  it('no posts, no years', () => {
    assert.deepEqual(postsModule.postsByYear([]), []);
  });
});

describe('readNextFor: the newest other posts in the same language', () => {
  const post = (slug: string, lang: string) => toBlogPost(apiPost({ id: `${lang}-${slug}`, slug, lang }));
  const all = [post('a', 'es'), post('x', 'en'), post('b', 'es'), post('c', 'es'), post('d', 'es'), post('e', 'es')];

  it('skips the post itself and other languages, and keeps at most 3 in order', () => {
    assert.deepEqual(postsModule.readNextFor(all, all[2]!).map((p) => p.slug), ['a', 'c', 'd']);
    assert.deepEqual(postsModule.readNextFor(all, all[1]!), []);
  });
});

describe('homeSections: featured, latest row, numbered list and topics of the home', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    toBlogPost(apiPost({ id: `p${i}`, slug: `p${i}`, tags: [`tag${i}`] })),
  );

  it('the newest is featured, the next 3 form the row and the next 4 the list, with no repeats', () => {
    const { featured, latest, more, topics } = postsModule.homeSections(many);
    assert.equal(featured?.slug, 'p0');
    assert.deepEqual(latest.map((p) => p.slug), ['p1', 'p2', 'p3']);
    assert.deepEqual(more.map((p) => p.slug), ['p4', 'p5', 'p6', 'p7']);
    assert.equal(topics.length, 8);
  });

  it('with few posts the later sections are empty, and with none nothing is featured', () => {
    const { latest, more } = postsModule.homeSections(many.slice(0, 2));
    assert.deepEqual([latest.map((p) => p.slug), more], [['p1'], []]);
    assert.deepEqual(postsModule.homeSections([]), { featured: undefined, latest: [], more: [], topics: [] });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderPreview } from '../src/editor/preview.ts';
import { META_DESCRIPTION_MAX, postPath, SEO_TITLE_MAX, sharePreview, siteNameFor, truncate, type ShareInput } from '../src/posts/seo.ts';

/* Share preview: the same derivation as the site (apps/web: BaseLayout, posts.ts, cover.ts). */

const input = (overrides: Partial<ShareInput> = {}): ShareInput => {
  const body = overrides.body ?? 'Primer párrafo del texto.';
  return {
    title: 'Mi post',
    summary: '',
    slug: 'mi-post',
    lang: 'es',
    coverUrl: '',
    coverAlt: '',
    siteName: 'El blog',
    origin: 'https://blog.example',
    html: renderPreview(body, overrides.lang ?? 'es').html,
    ...overrides,
    body,
  };
};

describe('public post path', () => {
  it('/es/articulos/<slug>/ and /en/articles/<slug>/', () => {
    assert.equal(postPath('es', 'hola'), '/es/articulos/hola/');
    assert.equal(postPath('en', 'hello'), '/en/articles/hello/');
  });
});

describe('sharePreview', () => {
  it('description = summary or, without one, the 160-character excerpt of the text', () => {
    assert.equal(sharePreview(input({ summary: '  Resumen propio. ' })).description, 'Resumen propio.');
    assert.equal(sharePreview(input()).description, 'Primer párrafo del texto.');
    const long = sharePreview(input({ body: 'palabra '.repeat(60) })).description;
    assert.ok(long.length <= META_DESCRIPTION_MAX + 1 && long.endsWith('…'), long);
  });

  it('image = the cover; if none, the first image of the text; otherwise none (small card)', () => {
    const cover = sharePreview(input({ coverUrl: '/media/tapa.webp', coverAlt: 'Tapa', body: '![otra](/media/otra.webp)' }));
    assert.deepEqual(cover.image, { src: 'https://blog.example/media/tapa.webp', alt: 'Tapa' });
    assert.equal(cover.largeCard, true);
    const fromBody = sharePreview(input({ body: 'Texto\n\n![Un gato & perro](img/gato.webp)' }));
    assert.deepEqual(fromBody.image, { src: 'https://blog.example/es/articulos/mi-post/img/gato.webp', alt: 'Un gato & perro' });
    const none = sharePreview(input({ coverUrl: 'javascript:alert(1)' }));
    assert.equal(none.image, null);
    assert.equal(none.largeCard, false);
  });

  it('the body image alt is decoded back from the renderer escaping, once (a typed "&lt;" stays as text)', () => {
    const preview = sharePreview(input({ body: `![Tom & "Jerry" <3 'x' &lt;](/media/a.webp)` }));
    assert.equal(preview.image?.alt, `Tom & "Jerry" <3 'x' &lt;`);
  });

  it('URL, domain and Google result (title with the site name, truncated)', () => {
    const preview = sharePreview(input({ lang: 'en', slug: '', title: 'Hello world' }));
    assert.equal(preview.url, 'https://blog.example/en/articles/hello-world/');
    assert.equal(preview.host, 'blog.example');
    assert.equal(preview.searchTitle, 'Hello world · El blog');
    const long = sharePreview(input({ title: 'palabra '.repeat(12).trim() })).searchTitle;
    assert.ok(long.length <= SEO_TITLE_MAX + 1 && long.endsWith('…'), long);
    assert.equal(sharePreview(input({ siteName: null })).searchTitle, 'Mi post');
  });

  it('truncate: cuts at a word and adds …; short text stays the same', () => {
    assert.equal(truncate('uno dos tres', 20), 'uno dos tres');
    assert.equal(truncate('uno dos tres cuatro', 10), 'uno dos…');
  });

  it('siteNameFor: the name is a single field for both languages (as on the site)', () => {
    assert.equal(siteNameFor({ name: ' Blog ' }), 'Blog');
    // A nameEn still sent by an old API changes nothing: the English post carries the same name.
    const legacy = { name: 'Blog', nameEn: 'The blog' };
    assert.equal(siteNameFor(legacy), 'Blog');
    assert.equal(sharePreview(input({ lang: 'en', siteName: siteNameFor(legacy) })).searchTitle, 'Mi post · Blog');
  });
});

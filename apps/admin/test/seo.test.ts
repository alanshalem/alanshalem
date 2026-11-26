import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderPreview } from '../src/editor/preview.ts';
import { META_DESCRIPTION_MAX, postPath, SEO_TITLE_MAX, sharePreview, siteNameFor, truncate, type ShareInput } from '../src/posts/seo.ts';

/* Vista previa al compartir (S3): la misma derivación que el sitio (apps/web: BaseLayout, posts.ts, cover.ts). */

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

describe('ruta pública del post', () => {
  it('/es/articulos/<slug>/ y /en/articles/<slug>/', () => {
    assert.equal(postPath('es', 'hola'), '/es/articulos/hola/');
    assert.equal(postPath('en', 'hello'), '/en/articles/hello/');
  });
});

describe('sharePreview', () => {
  it('descripción = resumen o, sin resumen, el extracto de 160 del texto', () => {
    assert.equal(sharePreview(input({ summary: '  Resumen propio. ' })).description, 'Resumen propio.');
    assert.equal(sharePreview(input()).description, 'Primer párrafo del texto.');
    const long = sharePreview(input({ body: 'palabra '.repeat(60) })).description;
    assert.ok(long.length <= META_DESCRIPTION_MAX + 1 && long.endsWith('…'), long);
  });

  it('imagen = la portada; si no hay, la primera imagen del texto; si no, ninguna (tarjeta chica)', () => {
    const cover = sharePreview(input({ coverUrl: '/media/tapa.webp', coverAlt: 'Tapa', body: '![otra](/media/otra.webp)' }));
    assert.deepEqual(cover.image, { src: 'https://blog.example/media/tapa.webp', alt: 'Tapa' });
    assert.equal(cover.largeCard, true);
    const fromBody = sharePreview(input({ body: 'Texto\n\n![Un gato & perro](img/gato.webp)' }));
    assert.deepEqual(fromBody.image, { src: 'https://blog.example/es/articulos/mi-post/img/gato.webp', alt: 'Un gato & perro' });
    const none = sharePreview(input({ coverUrl: 'javascript:alert(1)' }));
    assert.equal(none.image, null);
    assert.equal(none.largeCard, false);
  });

  it('URL, dominio y resultado de Google (título con el nombre del sitio, recortado)', () => {
    const preview = sharePreview(input({ lang: 'en', slug: '', title: 'Hello world' }));
    assert.equal(preview.url, 'https://blog.example/en/articles/hello-world/');
    assert.equal(preview.host, 'blog.example');
    assert.equal(preview.searchTitle, 'Hello world · El blog');
    const long = sharePreview(input({ title: 'palabra '.repeat(12).trim() })).searchTitle;
    assert.ok(long.length <= SEO_TITLE_MAX + 1 && long.endsWith('…'), long);
    assert.equal(sharePreview(input({ siteName: null })).searchTitle, 'Mi post');
  });

  it('truncate: corta en una palabra y agrega …; lo corto queda igual', () => {
    assert.equal(truncate('uno dos tres', 20), 'uno dos tres');
    assert.equal(truncate('uno dos tres cuatro', 10), 'uno dos…');
  });

  it('siteNameFor: el nombre es uno solo en los dos idiomas (L12, como el sitio)', () => {
    assert.equal(siteNameFor({ name: ' Blog ' }), 'Blog');
    // Un nameEn que todavía mande una API vieja no cambia nada: el post en inglés lleva el mismo nombre.
    const legacy = { name: 'Blog', nameEn: 'The blog' };
    assert.equal(siteNameFor(legacy), 'Blog');
    assert.equal(sharePreview(input({ lang: 'en', siteName: siteNameFor(legacy) })).searchTitle, 'Mi post · Blog');
  });
});

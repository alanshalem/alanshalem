import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

describe('toBlogPost: idioma y grupo de traducción (L4)', () => {
  it('conserva lang y translationGroupId; la ruta sale del idioma', () => {
    const post = toBlogPost(apiPost({ lang: 'en', slug: 'hello', translationGroupId: 'g9' }));
    assert.equal(post.lang, 'en');
    assert.equal(post.translationGroupId, 'g9');
    assert.equal(postPath(post), '/en/articles/hello/');
  });
  it('sin translationGroupId (API anterior a T1) cada post es su propio grupo', () => {
    const { translationGroupId, ...old } = apiPost({ id: 'solo' });
    assert.equal(translationGroupId, 'g1');
    assert.equal(toBlogPost(old).translationGroupId, 'solo');
  });
  it('un idioma desconocido frena el build (no se publica bajo otro idioma)', () => {
    assert.throws(() => toBlogPost(apiPost({ lang: 'fr' })), /idioma "fr"/);
  });
  it('las imágenes relativas del Markdown se resuelven contra la página del post en su idioma', () => {
    const post = toBlogPost(apiPost({ lang: 'en', slug: 'hello', body: '![x](img/a.png)' }));
    assert.equal(post.cover.kind === 'image' && post.cover.src, '/en/articles/hello/img/a.png');
  });
});

describe('toBlogPost: extensiones de Markdown del cuerpo en el idioma del post (editor-pro L4, L5)', () => {
  it('las cajas destacadas se titulan en el idioma del post', () => {
    const callout = '> [!NOTE]\n> Texto.';
    assert.match(toBlogPost(apiPost({ lang: 'en', body: callout })).html, /<p class="callout-title">Note<\/p>/);
    assert.match(toBlogPost(apiPost({ lang: 'es', body: callout })).html, /<p class="callout-title">Nota<\/p>/);
  });
  it('una imagen sola con título es una figura con epígrafe, y sigue sirviendo de portada', () => {
    const post = toBlogPost(apiPost({ body: '![Faro](/media/faro.jpg "Faro de noche")' }));
    assert.match(post.html, /^<figure><img src="\/media\/faro\.jpg" alt="Faro"[^>]*><figcaption>Faro de noche<\/figcaption><\/figure>$/);
    assert.equal(post.cover.kind === 'image' && post.cover.src, '/media/faro.jpg');
  });
  it('tipografía inteligente: comillas, rayas y puntos suspensivos, nunca dentro del código', () => {
    const { html } = toBlogPost(apiPost({ lang: 'en', body: 'He said "wait" -- then... `a -- "b"`' }));
    assert.equal(html, '<p>He said “wait” – then… <code>a -- &quot;b&quot;</code></p>');
  });
  it('el título del cuerpo sigue bajando un nivel (el <h1> es el título del post)', () => {
    assert.match(toBlogPost(apiPost({ body: '# Uno' })).html, /^<h2 id="uno">Uno<\/h2>$/);
  });
});

describe('alternatesByGroup: versiones publicadas de cada grupo (L3)', () => {
  const es = toBlogPost(apiPost({ id: 'a', slug: 'hola', lang: 'es', translationGroupId: 'g1' }));
  const en = toBlogPost(apiPost({ id: 'b', slug: 'hello', lang: 'en', translationGroupId: 'g1' }));
  const solo = toBlogPost(apiPost({ id: 'c', slug: 'solo', lang: 'es', translationGroupId: 'g2' }));

  it('une las versiones por grupo, con la ruta de cada idioma', () => {
    const map = alternatesByGroup([es, en, solo]);
    assert.deepEqual(map.get('g1'), { es: '/es/articulos/hola/', en: '/en/articles/hello/' });
    assert.deepEqual(map.get('g2'), { es: '/es/articulos/solo/' });
    assert.equal(map.size, 2);
  });
});

describe('posts y temas por idioma', () => {
  const es1 = toBlogPost(apiPost({ id: 'a', slug: 'a', lang: 'es', tags: ['Rendimiento', '.NET'] }));
  const es2 = toBlogPost(apiPost({ id: 'b', slug: 'b', lang: 'es', tags: ['.NET'] }));
  const en1 = toBlogPost(apiPost({ id: 'c', slug: 'c', lang: 'en', tags: ['Performance'] }));

  it('postsIn filtra por idioma sin cambiar el orden', () => {
    assert.deepEqual(postsIn([es1, en1, es2], 'es').map((p) => p.slug), ['a', 'b']);
    assert.deepEqual(postsIn([es1, en1, es2], 'en').map((p) => p.slug), ['c']);
  });
  it('tagsOf: temas de esos posts, por cantidad y después por nombre', () => {
    assert.deepEqual(
      tagsOf([es1, es2]).map(({ tag, posts }) => [tag.slug, posts.length]),
      [['net', 2], ['rendimiento', 1]],
    );
    assert.deepEqual(tagsOf([en1]).map(({ tag }) => tag.name), ['Performance']);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostSummary } from '../src/api/types.ts';
import { DEFAULT_LANG, LANG_IN_SENTENCE, LANG_LABELS, LANGS } from '../src/languages.ts';
import { groupPosts, translationWarnings, versionLabel, versionSlots } from '../src/posts/versions.ts';

/* Versiones de un post por idioma (L3, L4): la lista agrupa por translationGroupId y el editor avisa en la traducción. */

const summary = (id: string, overrides: Partial<PostSummary> = {}): PostSummary => ({
  id,
  slug: id,
  title: `Título ${id}`,
  status: 'draft',
  updatedAt: '2026-11-25T10:00:00Z',
  publishedAt: null,
  coverUrl: null,
  coverAlt: null,
  lang: 'es',
  translationGroupId: `g-${id}`,
  translations: [],
  ...overrides,
});

describe('languages: los dos idiomas fijos en un solo lugar (L3)', () => {
  it('español primero y por defecto; inglés', () => {
    assert.deepEqual(LANGS, ['es', 'en']);
    assert.equal(DEFAULT_LANG, 'es');
  });
  it('etiquetas del selector y del texto del admin', () => {
    assert.deepEqual(LANG_LABELS, { es: 'Español', en: 'English' });
    assert.deepEqual(LANG_IN_SENTENCE, { es: 'español', en: 'inglés' });
  });
});

describe('groupPosts: una fila por grupo de traducción', () => {
  it('junta las versiones del mismo grupo y respeta el orden en que llega cada grupo', () => {
    const posts = [
      summary('en1', { lang: 'en', translationGroupId: 'g1', updatedAt: '2026-11-25T12:00:00Z' }),
      summary('solo', { translationGroupId: 'g2', updatedAt: '2026-11-25T11:00:00Z' }),
      summary('es1', { lang: 'es', translationGroupId: 'g1', updatedAt: '2026-11-25T09:00:00Z' }),
    ];
    const groups = groupPosts(posts);
    assert.deepEqual(
      groups.map((group) => [group.id, group.versions.map((version) => version.id)]),
      [
        ['g1', ['en1', 'es1']],
        ['g2', ['solo']],
      ],
    );
  });

  it('el título y el enlace salen de la versión en español cuando existe', () => {
    const [group] = groupPosts([
      summary('en1', { lang: 'en', translationGroupId: 'g1', title: 'Hello' }),
      summary('es1', { lang: 'es', translationGroupId: 'g1', title: 'Hola' }),
    ]);
    assert.equal(group?.main.id, 'es1');
    assert.equal(group?.main.title, 'Hola');
  });

  it('sin versión en español, la fila usa la que haya', () => {
    const [group] = groupPosts([summary('en1', { lang: 'en', title: 'Only English' })]);
    assert.equal(group?.main.id, 'en1');
  });

  it('la fecha del grupo es la última edición de cualquiera de sus versiones', () => {
    const [group] = groupPosts([
      summary('es1', { translationGroupId: 'g1', updatedAt: '2026-11-25T09:00:00Z' }),
      summary('en1', { lang: 'en', translationGroupId: 'g1', updatedAt: '2026-11-26T09:00:00Z' }),
    ]);
    assert.equal(group?.updatedAt, '2026-11-26T09:00:00Z');
  });

  it('lista vacía: ningún grupo', () => {
    assert.deepEqual(groupPosts([]), []);
  });
});

describe('versionSlots: un lugar por idioma, con su versión o vacío', () => {
  it('en el orden de LANGS; el idioma sin versión queda en null', () => {
    const es = summary('es1');
    assert.deepEqual(versionSlots([es]), [
      { lang: 'es', version: es },
      { lang: 'en', version: null },
    ]);
  });

  it('puede excluir el idioma propio (el editor solo lista las otras versiones)', () => {
    const en = { id: 'en1', lang: 'en' as const, slug: 'hello', status: 'published' as const, updatedAt: '' };
    assert.deepEqual(versionSlots([en], 'es'), [{ lang: 'en', version: en }]);
    assert.deepEqual(versionSlots([], 'en'), [{ lang: 'es', version: null }]);
  });
});

describe('versionLabel: el texto del chip por idioma', () => {
  it('código del idioma y estado, o "Falta"', () => {
    assert.equal(versionLabel('es', 'published'), 'ES · Publicado');
    assert.equal(versionLabel('en', 'draft'), 'EN · Borrador');
    assert.equal(versionLabel('en', null), 'EN · Falta');
  });
});

describe('translationWarnings: "Sin traducir" y "Desactualizada" en la traducción (L3)', () => {
  const original = { title: 'Hola mundo', body: '# Hola\n\nTexto.', createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z' };
  const translation = (overrides: Partial<typeof original> = {}) => ({
    title: 'Hello world',
    body: '# Hello\n\nText.',
    createdAt: '2026-11-22T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z',
    ...overrides,
  });

  it('traducida y al día: sin avisos', () => {
    assert.deepEqual(translationWarnings(translation(), original), []);
  });

  it('recién creada (contenido copiado): sin traducir', () => {
    assert.deepEqual(translationWarnings(translation({ title: original.title, body: original.body }), original), ['untranslated']);
  });

  it('basta con que el título o el cuerpo sigan iguales (sin contar espacios de los bordes)', () => {
    assert.deepEqual(translationWarnings(translation({ title: ` ${original.title} ` }), original), ['untranslated']);
    assert.deepEqual(translationWarnings(translation({ body: `${original.body}\n` }), original), ['untranslated']);
  });

  it('el original se editó después de la última edición de la traducción: desactualizada', () => {
    assert.deepEqual(translationWarnings(translation({ updatedAt: '2026-11-21T09:59:59Z' }), original), ['outdated']);
  });

  it('misma fecha de edición: no está desactualizada', () => {
    assert.deepEqual(translationWarnings(translation({ updatedAt: original.updatedAt }), original), []);
  });

  it('los dos avisos a la vez', () => {
    assert.deepEqual(
      translationWarnings(translation({ title: original.title, updatedAt: '2026-11-21T00:00:00Z' }), original),
      ['untranslated', 'outdated'],
    );
  });

  it('el original (la versión creada antes) nunca muestra avisos', () => {
    const copy = translation({ title: original.title, body: original.body });
    assert.deepEqual(translationWarnings(original, copy), []);
  });
});

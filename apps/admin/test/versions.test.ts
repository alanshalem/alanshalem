import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostSummary } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import { DEFAULT_LANG, LANGS } from '../src/languages.ts';
import { groupPosts, translationWarnings, versionLabel, versionSlots } from '../src/posts/versions.ts';

/* Versiones de un post por idioma (L3, L4): la lista agrupa por translationGroupId y el editor avisa en la traducción. */

const es = i18nFor('es');
const en = i18nFor('en');

const summary = (id: string, overrides: Partial<PostSummary> = {}): PostSummary => ({
  id,
  slug: id,
  title: `Título ${id}`,
  status: 'draft',
  updatedAt: '2026-11-25T10:00:00Z',
  contentUpdatedAt: '2026-11-25T10:00:00Z',
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
  it('sus nombres en la interfaz: en español, Español e Inglés; en inglés, Spanish y English', () => {
    const names = (i18n: typeof es) =>
      LANGS.map((lang) => [i18n.t(`lang.label.${lang}`), i18n.t(`lang.inSentence.${lang}`)]);
    assert.deepEqual(names(es), [
      ['Español', 'español'],
      ['Inglés', 'inglés'],
    ]);
    assert.deepEqual(names(en), [
      ['Spanish', 'Spanish'],
      ['English', 'English'],
    ]);
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
    assert.equal(versionLabel('es', 'published', es), 'ES · Publicado');
    assert.equal(versionLabel('en', 'draft', es), 'EN · Borrador');
    assert.equal(versionLabel('en', null, es), 'EN · Falta');
  });

  it('en inglés: el código no cambia, el estado sí', () => {
    assert.equal(versionLabel('es', 'published', en), 'ES · Published');
    assert.equal(versionLabel('en', 'draft', en), 'EN · Draft');
    assert.equal(versionLabel('en', null, en), 'EN · Missing');
  });
});

describe('translationWarnings: "Sin traducir" y "Desactualizada" en la traducción (L3)', () => {
  const original = { title: 'Hola mundo', body: '# Hola\n\nTexto.', createdAt: '2026-11-20T10:00:00Z', contentUpdatedAt: '2026-11-21T10:00:00Z' };
  const translation = (overrides: Partial<typeof original> = {}) => ({
    title: 'Hello world',
    body: '# Hello\n\nText.',
    createdAt: '2026-11-22T10:00:00Z',
    contentUpdatedAt: '2026-11-23T10:00:00Z',
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

  it('el contenido del original cambió después del de la traducción: desactualizada', () => {
    assert.deepEqual(translationWarnings(translation({ contentUpdatedAt: '2026-11-21T09:59:59Z' }), original), ['outdated']);
  });

  it('misma fecha de cambio de contenido: no está desactualizada', () => {
    assert.deepEqual(translationWarnings(translation({ contentUpdatedAt: original.contentUpdatedAt }), original), []);
  });

  it('los dos avisos a la vez', () => {
    assert.deepEqual(
      translationWarnings(translation({ title: original.title, contentUpdatedAt: '2026-11-21T00:00:00Z' }), original),
      ['untranslated', 'outdated'],
    );
  });

  // Multiidioma L9: publicar, despublicar o programar cambian `updatedAt` pero no el contenido. Los avisos miran
  // `contentUpdatedAt`; `updatedAt` va en los datos a propósito, para que mirarlo haga fallar estos casos.
  it('publicar el original sin cambiar su contenido no marca la traducción como desactualizada', () => {
    const t = (hour: number) => `2026-11-25T${String(hour).padStart(2, '0')}:00:00Z`;
    // Original creado en t0; traducción creada en t1 y editada en t2; original publicado en t3 sin cambios.
    const publishedOriginal = { title: 'Hola', body: 'Texto.', createdAt: t(0), contentUpdatedAt: t(0), updatedAt: t(3) };
    const upToDate = { title: 'Hello', body: 'Text.', createdAt: t(1), contentUpdatedAt: t(2), updatedAt: t(2) };
    assert.deepEqual(translationWarnings(upToDate, publishedOriginal), []);
  });

  it('publicar la traducción no borra un "desactualizada" real', () => {
    const t = (hour: number) => `2026-11-25T${String(hour).padStart(2, '0')}:00:00Z`;
    // Traducción creada en t1; original editado en t2; traducción publicada en t3 sin ponerse al día.
    const editedOriginal = { title: 'Hola', body: 'Texto nuevo.', createdAt: t(0), contentUpdatedAt: t(2), updatedAt: t(2) };
    const published = { title: 'Hello', body: 'Text.', createdAt: t(1), contentUpdatedAt: t(1), updatedAt: t(3) };
    assert.deepEqual(translationWarnings(published, editedOriginal), ['outdated']);
  });

  it('el original (la versión creada antes) nunca muestra avisos', () => {
    const copy = translation({ title: original.title, body: original.body });
    assert.deepEqual(translationWarnings(original, copy), []);
  });
});

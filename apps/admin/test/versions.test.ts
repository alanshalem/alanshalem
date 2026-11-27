import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostSummary } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import { DEFAULT_LANG, LANGS } from '../src/languages.ts';
import { groupPosts, missingVersion, translationWarnings, versionLabel, versionSlots } from '../src/posts/versions.ts';

/* A post's language versions: the list groups by translationGroupId and the editor warns in the translation. */

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
  scheduledAt: null,
  coverUrl: null,
  coverAlt: null,
  lang: 'es',
  translationGroupId: `g-${id}`,
  translations: [],
  ...overrides,
});

describe('languages: the two fixed languages in one place', () => {
  it('Spanish first and default; English', () => {
    assert.deepEqual(LANGS, ['es', 'en']);
    assert.equal(DEFAULT_LANG, 'es');
  });
  it('their UI names: in Spanish, Español and Inglés; in English, Spanish and English', () => {
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

describe('groupPosts: one row per translation group', () => {
  it('joins the versions of the same group and keeps the order each group arrives in', () => {
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

  it('the title and link come from the Spanish version when it exists', () => {
    const [group] = groupPosts([
      summary('en1', { lang: 'en', translationGroupId: 'g1', title: 'Hello' }),
      summary('es1', { lang: 'es', translationGroupId: 'g1', title: 'Hola' }),
    ]);
    assert.equal(group?.main.id, 'es1');
    assert.equal(group?.main.title, 'Hola');
  });

  it('without a Spanish version, the row uses whichever there is', () => {
    const [group] = groupPosts([summary('en1', { lang: 'en', title: 'Only English' })]);
    assert.equal(group?.main.id, 'en1');
  });

  it('the group date is the latest edit of any of its versions', () => {
    const [group] = groupPosts([
      summary('es1', { translationGroupId: 'g1', updatedAt: '2026-11-25T09:00:00Z' }),
      summary('en1', { lang: 'en', translationGroupId: 'g1', updatedAt: '2026-11-26T09:00:00Z' }),
    ]);
    assert.equal(group?.updatedAt, '2026-11-26T09:00:00Z');
  });

  it('empty list: no groups', () => {
    assert.deepEqual(groupPosts([]), []);
  });
});

describe('versionSlots: one slot per language, with its version or empty', () => {
  it('in LANGS order; a language without a version stays null', () => {
    const es = summary('es1');
    assert.deepEqual(versionSlots([es]), [
      { lang: 'es', version: es },
      { lang: 'en', version: null },
    ]);
  });

  it('can exclude its own language (the editor only lists the other versions)', () => {
    const en = { id: 'en1', lang: 'en' as const, slug: 'hello', status: 'published' as const, updatedAt: '' };
    assert.deepEqual(versionSlots([en], 'es'), [{ lang: 'en', version: en }]);
    assert.deepEqual(versionSlots([], 'en'), [{ lang: 'es', version: null }]);
  });
});

describe('versionLabel: the chip text per language', () => {
  it('language code and status', () => {
    assert.equal(versionLabel('es', 'published', es), 'ES · Publicado');
    assert.equal(versionLabel('en', 'draft', es), 'EN · Borrador');
  });

  it('in English: the code stays, the status changes', () => {
    assert.equal(versionLabel('es', 'published', en), 'ES · Published');
    assert.equal(versionLabel('en', 'draft', en), 'EN · Draft');
  });
});

describe('missingVersion: the chip of a missing version is the action that creates it', () => {
  it('shows "+ EN" and announces "Crear versión en inglés", with the visible code in the name (WCAG 2.5.3)', () => {
    assert.deepEqual(missingVersion('en', es), { text: '+ EN', label: 'Crear versión en inglés (EN)' });
    assert.deepEqual(missingVersion('es', es), { text: '+ ES', label: 'Crear versión en español (ES)' });
  });

  it('in English', () => {
    assert.deepEqual(missingVersion('en', en), { text: '+ EN', label: 'Create English version (EN)' });
    assert.deepEqual(missingVersion('es', en), { text: '+ ES', label: 'Create Spanish version (ES)' });
  });
});

describe('translationWarnings: "Sin traducir" and "Desactualizada" in the translation', () => {
  const original = { title: 'Hola mundo', body: '# Hola\n\nTexto.', createdAt: '2026-11-20T10:00:00Z', contentUpdatedAt: '2026-11-21T10:00:00Z' };
  const translation = (overrides: Partial<typeof original> = {}) => ({
    title: 'Hello world',
    body: '# Hello\n\nText.',
    createdAt: '2026-11-22T10:00:00Z',
    contentUpdatedAt: '2026-11-23T10:00:00Z',
    ...overrides,
  });

  it('translated and up to date: no warnings', () => {
    assert.deepEqual(translationWarnings(translation(), original), []);
  });

  it('just created (copied content): untranslated', () => {
    assert.deepEqual(translationWarnings(translation({ title: original.title, body: original.body }), original), ['untranslated']);
  });

  it('it is enough for the title or the body to stay equal (ignoring edge spaces)', () => {
    assert.deepEqual(translationWarnings(translation({ title: ` ${original.title} ` }), original), ['untranslated']);
    assert.deepEqual(translationWarnings(translation({ body: `${original.body}\n` }), original), ['untranslated']);
  });

  it('the original content changed after the translation one: outdated', () => {
    assert.deepEqual(translationWarnings(translation({ contentUpdatedAt: '2026-11-21T09:59:59Z' }), original), ['outdated']);
  });

  it('same content change date: not outdated', () => {
    assert.deepEqual(translationWarnings(translation({ contentUpdatedAt: original.contentUpdatedAt }), original), []);
  });

  it('both warnings at once', () => {
    assert.deepEqual(
      translationWarnings(translation({ title: original.title, contentUpdatedAt: '2026-11-21T00:00:00Z' }), original),
      ['untranslated', 'outdated'],
    );
  });

  // Publishing, unpublishing or scheduling change `updatedAt` but not the content. The warnings look at
  // `contentUpdatedAt`; `updatedAt` is in the data on purpose, so looking at it makes these cases fail.
  it('publishing the original without changing its content does not mark the translation outdated', () => {
    const t = (hour: number) => `2026-11-25T${String(hour).padStart(2, '0')}:00:00Z`;
    // Original created at t0; translation created at t1 and edited at t2; original published at t3 unchanged.
    const publishedOriginal = { title: 'Hola', body: 'Texto.', createdAt: t(0), contentUpdatedAt: t(0), updatedAt: t(3) };
    const upToDate = { title: 'Hello', body: 'Text.', createdAt: t(1), contentUpdatedAt: t(2), updatedAt: t(2) };
    assert.deepEqual(translationWarnings(upToDate, publishedOriginal), []);
  });

  it('publishing the translation does not clear a real "Desactualizada"', () => {
    const t = (hour: number) => `2026-11-25T${String(hour).padStart(2, '0')}:00:00Z`;
    // Translation created at t1; original edited at t2; translation published at t3 without catching up.
    const editedOriginal = { title: 'Hola', body: 'Texto nuevo.', createdAt: t(0), contentUpdatedAt: t(2), updatedAt: t(2) };
    const published = { title: 'Hello', body: 'Text.', createdAt: t(1), contentUpdatedAt: t(1), updatedAt: t(3) };
    assert.deepEqual(translationWarnings(published, editedOriginal), ['outdated']);
  });

  it('the original (the version created first) never shows warnings', () => {
    const copy = translation({ title: original.title, body: original.body });
    assert.deepEqual(translationWarnings(original, copy), []);
  });
});

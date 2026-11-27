import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Post } from '../src/api/types.ts';
import { EMPTY_POST_FORM, toPostForm, toPostInput } from '../src/posts/postForm.ts';

/* The post editor form: what the API returns, as fields to edit, and those fields back as what gets saved. */

const post = (overrides: Partial<Post> = {}): Post => ({
  id: 'p1',
  slug: 'mi-post',
  title: 'Mi post',
  status: 'draft',
  updatedAt: '2026-11-25T10:00:00Z',
  contentUpdatedAt: '2026-11-25T10:00:00Z',
  publishedAt: null,
  scheduledAt: null,
  coverUrl: null,
  coverAlt: null,
  lang: 'es',
  translationGroupId: 'g1',
  translations: [],
  summary: 'Un resumen',
  body: '## Hola\n\nTexto.\n',
  tags: ['viajes', 'fotos'],
  createdAt: '2026-11-25T10:00:00Z',
  ...overrides,
});

describe('EMPTY_POST_FORM: a new post', () => {
  it('starts with every field empty', () => {
    assert.deepEqual(EMPTY_POST_FORM, { title: '', slug: '', summary: '', tags: '', body: '', coverUrl: '', coverAlt: '' });
  });
});

describe('toPostForm: the loaded post as editable fields', () => {
  it('joins the tags with a comma and a space; no cover is an empty field', () => {
    assert.deepEqual(toPostForm(post()), {
      title: 'Mi post',
      slug: 'mi-post',
      summary: 'Un resumen',
      tags: 'viajes, fotos',
      body: '## Hola\n\nTexto.\n',
      coverUrl: '',
      coverAlt: '',
    });
  });

  it('keeps the cover when there is one', () => {
    const form = toPostForm(post({ coverUrl: '/media/a.jpg', coverAlt: 'Un faro' }));
    assert.equal(form.coverUrl, '/media/a.jpg');
    assert.equal(form.coverAlt, 'Un faro');
  });
});

describe('toPostInput: the fields as what gets saved', () => {
  const form = {
    title: '  Mi post ',
    slug: ' mi-post ',
    summary: ' Un resumen\n',
    tags: ' viajes , ,fotos,  ',
    body: '  ## Hola\n',
    coverUrl: ' /media/a.jpg ',
    coverAlt: ' Un faro ',
  };

  it('trims title, slug and summary; splits the tags on commas and drops the empty ones; the body stays as written', () => {
    assert.deepEqual(toPostInput(form, { coverUrl: '/media/a.jpg', coverAlt: 'Un faro' }), {
      title: 'Mi post',
      slug: 'mi-post',
      summary: 'Un resumen',
      body: '  ## Hola\n',
      tags: ['viajes', 'fotos'],
      coverUrl: '/media/a.jpg',
      coverAlt: 'Un faro',
    });
  });

  it('without a validated cover it carries the cover fields as typed (the history comparison normalizes them)', () => {
    const input = toPostInput(form);
    assert.equal(input.coverUrl, ' /media/a.jpg ');
    assert.equal(input.coverAlt, ' Un faro ');
  });

  it('no tags is an empty list', () => {
    assert.deepEqual(toPostInput({ ...EMPTY_POST_FORM, tags: ' , ' }).tags, []);
  });

  it('a loaded post goes back unchanged (load, then save without edits)', () => {
    const loaded = post({ coverUrl: '/media/a.jpg', coverAlt: 'Un faro' });
    assert.deepEqual(toPostInput(toPostForm(loaded)), {
      title: loaded.title,
      slug: loaded.slug,
      summary: loaded.summary,
      body: loaded.body,
      tags: loaded.tags,
      coverUrl: '/media/a.jpg',
      coverAlt: 'Un faro',
    });
  });
});

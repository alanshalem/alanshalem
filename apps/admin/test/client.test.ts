import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { api, ApiError, setApiLanguage } from '../src/api/client.ts';
import { errorMessage } from '../src/api/problem.ts';

/* HTTP contract of the hero videos, with a fake fetch: path, method, body and response. */

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let respond: () => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const processing = { id: 'v1', status: 'processing', error: null, width: 1920, height: 1080, durationSeconds: 8, poster: null, sources: [], warnings: [], createdAt: '' };

describe('api.uploadVideo', () => {
  it('POSTs multipart to /api/admin/media/videos and returns the VideoAsset of the 202', async () => {
    respond = () => json(202, processing);
    const file = new File(['x'], 'mar.mp4', { type: 'video/mp4' });

    assert.deepEqual(await api.uploadVideo(file), processing);

    const [call] = calls;
    assert.equal(call?.url, '/api/admin/media/videos');
    assert.equal(call?.init.method, 'POST');
    assert.ok(call?.init.body instanceof FormData);
    assert.equal(((call.init.body as FormData).get('file') as File).name, 'mar.mp4');
  });

  it('without an edit it sends no trim fields (the API applies its defaults)', async () => {
    respond = () => json(202, processing);
    await api.uploadVideo(new File(['x'], 'mar.mp4', { type: 'video/mp4' }));
    const form = calls[0]?.init.body as FormData;
    assert.deepEqual([...form.keys()], ['file']);
  });

  it('with an edit it adds trimStart, trimEnd, fade and fadeSeconds, with a decimal point', async () => {
    respond = () => json(202, processing);
    const file = new File(['x'], 'mar.mp4', { type: 'video/mp4' });
    await api.uploadVideo(file, { trimStart: 2.5, trimEnd: 15, fade: 'black', fadeSeconds: 0.5 });

    const form = calls[0]?.init.body as FormData;
    assert.equal(calls[0]?.url, '/api/admin/media/videos');
    assert.equal((form.get('file') as File).name, 'mar.mp4');
    assert.deepEqual(
      [...form.entries()].filter(([key]) => key !== 'file'),
      [
        ['trimStart', '2.5'],
        ['trimEnd', '15'],
        ['fade', 'black'],
        ['fadeSeconds', '0.5'],
      ],
    );
  });

  it('a 400 arrives as an ApiError with the ProblemDetails detail', async () => {
    respond = () => json(400, { title: 'Datos inválidos', detail: 'Dura 20 s: el máximo es 15 s.' });
    await assert.rejects(api.uploadVideo(new File(['x'], 'a.mp4')), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, 'Dura 20 s: el máximo es 15 s.');
      return true;
    });
  });
});

describe('api.uploadMedia (shares the multipart building with the videos)', () => {
  it('still POSTs the file to /api/admin/media', async () => {
    respond = () => json(201, { id: 'm1', url: '/media/h/1600.webp' });
    assert.equal(await api.uploadImage(new File(['x'], 'luna.jpg', { type: 'image/jpeg' })), '/media/h/1600.webp');
    assert.equal(calls[0]?.url, '/api/admin/media');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal(((calls[0]?.init.body as FormData).get('file') as File).name, 'luna.jpg');
  });
});

describe('api.getVideo', () => {
  it('GET /api/admin/media/videos/{id} with the id escaped', async () => {
    respond = () => json(200, { ...processing, status: 'ready' });
    assert.equal((await api.getVideo('a/b')).status, 'ready');
    assert.equal(calls[0]?.url, '/api/admin/media/videos/a%2Fb');
    assert.equal(calls[0]?.init.method, 'GET');
  });
});

describe('api.createHeroImage', () => {
  it('ready video: sends { videoId, alt, credit }', async () => {
    respond = () => json(201, {});
    await api.createHeroImage({ videoId: 'v1' }, { alt: 'Olas', credit: null, altEn: null });
    assert.equal(calls[0]?.url, '/api/admin/hero-images');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { videoId: 'v1', alt: 'Olas', credit: null, altEn: null });
  });

  it('photo: still sends { mediaId, alt, credit }', async () => {
    respond = () => json(201, {});
    await api.createHeroImage({ mediaId: 'm1' }, { alt: 'Luna', credit: 'Foto: Alan', altEn: null });
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { mediaId: 'm1', alt: 'Luna', credit: 'Foto: Alan', altEn: null });
  });
});

/* Language versions: the language only travels on create; "Crear versión" is its own endpoint. */

describe('api.createPost / api.updatePost: the language only on create', () => {
  const input = { title: 'Hola', slug: '', summary: '', body: 'Texto', tags: [], coverUrl: null, coverAlt: null };

  it('POST /api/admin/posts adds the chosen language', async () => {
    respond = () => json(201, {});
    await api.createPost(input, 'en');
    assert.equal(calls[0]?.url, '/api/admin/posts');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { ...input, lang: 'en' });
  });

  it('PUT sends no language (an existing post cannot change it)', async () => {
    respond = () => json(200, {});
    await api.updatePost('p1', input);
    assert.equal(calls[0]?.url, '/api/admin/posts/p1');
    assert.equal(calls[0]?.init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), input);
  });
});

describe('api.createTranslation', () => {
  it('POST /api/admin/posts/{id}/translations with { lang } returns the draft of the 201', async () => {
    const draft = { id: 'p2', lang: 'en', status: 'draft' };
    respond = () => json(201, draft);
    assert.deepEqual(await api.createTranslation('a/b', 'en'), draft);
    assert.equal(calls[0]?.url, '/api/admin/posts/a%2Fb/translations');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { lang: 'en' });
    assert.equal((calls[0]?.init.headers as Record<string, string>)['X-Requested-With'], 'blog-admin');
  });

  it('a 409 arrives as an ApiError with the API message', async () => {
    respond = () => json(409, { title: 'Conflicto', detail: 'Ya existe la versión en inglés.' });
    await assert.rejects(api.createTranslation('p1', 'en'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message, 'Ya existe la versión en inglés.');
      return true;
    });
  });
});

describe('api.createHeroImage / api.updateHeroImage: English texts', () => {
  it('sends altEn next to the Spanish ones; the credit is a single field', async () => {
    respond = () => json(201, {});
    const input = { alt: 'Luna', credit: 'Foto: Alan', altEn: 'Moon' };
    await api.createHeroImage({ mediaId: 'm1' }, input);
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { mediaId: 'm1', ...input });
    await api.updateHeroImage('h1', input);
    assert.equal(calls[1]?.init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1]?.init.body as string), input);
  });
});

describe('errorMessage: the text a failed call shows', () => {
  it('an Error shows its own message (an ApiError carries the API text, already in the UI language)', () => {
    assert.equal(errorMessage(new ApiError(409, 'Ya existe una versión en inglés.'), 'fallback'), 'Ya existe una versión en inglés.');
    assert.equal(errorMessage(new TypeError('Failed to fetch'), 'fallback'), 'Failed to fetch');
  });

  it('anything else that was thrown shows the fallback', () => {
    assert.equal(errorMessage('boom', 'Could not save.'), 'Could not save.');
    assert.equal(errorMessage(undefined, 'Could not save.'), 'Could not save.');
    assert.equal(errorMessage({ message: 'not an Error' }, 'Could not save.'), 'Could not save.');
  });
});

describe('language of the API messages', () => {
  it('every request sends Accept-Language with the UI language, so errors arrive in that language', async () => {
    respond = () => json(200, []);
    setApiLanguage('en');
    await api.listPosts();
    setApiLanguage('es');
    await api.listPosts();
    assert.deepEqual(
      calls.map((call) => (call.init.headers as Record<string, string>)['Accept-Language']),
      ['en', 'es'],
    );
  });
});

describe('revision history and scheduled publishing (contract of 6c40950)', () => {
  const post = { id: 'p1', status: 'draft', scheduledAt: '2026-12-01T12:00:00Z' };

  it('lists, opens and restores revisions with GET/GET/POST under /revisions', async () => {
    respond = () => json(200, []);
    await api.listRevisions('p1');
    await api.getRevision('p1', 'r2');
    respond = () => json(200, post);
    assert.deepEqual(await api.restoreRevision('p1', 'r2'), post);
    assert.deepEqual(
      calls.map((call) => [call.init.method, call.url]),
      [
        ['GET', '/api/admin/posts/p1/revisions'],
        ['GET', '/api/admin/posts/p1/revisions/r2'],
        ['POST', '/api/admin/posts/p1/revisions/r2/restore'],
      ],
    );
    assert.equal(calls[2]?.init.body, undefined);
  });

  it('schedule: PUT /schedule with { publishAt } (ISO with offset); cancel: DELETE /schedule', async () => {
    respond = () => json(200, post);
    await api.schedulePost('p1', '2026-12-01T09:00:00-03:00');
    await api.unschedulePost('p1');
    assert.equal(calls[0]?.init.method, 'PUT');
    assert.equal(calls[0]?.url, '/api/admin/posts/p1/schedule');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { publishAt: '2026-12-01T09:00:00-03:00' });
    assert.equal(calls[1]?.init.method, 'DELETE');
    assert.equal(calls[1]?.url, '/api/admin/posts/p1/schedule');
  });

  it('an API 400 arrives with its message as is (the `detail` already comes in the requested language)', async () => {
    respond = () =>
      json(400, { title: 'Bad request', detail: 'The publication date has to be in the future.', code: 'post.scheduleInPast' });
    await assert.rejects(api.schedulePost('p1', '2020-01-01T00:00:00Z'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, 'The publication date has to be in the future.');
      return true;
    });
  });
});

/* Every path of a post comes from one builder: the id always encoded. */
describe('post paths: one builder, encoded id', () => {
  it('every operation on a post uses /api/admin/posts/{encoded id}', async () => {
    respond = () => json(200, {});
    const id = 'a/b?c';
    const base = '/api/admin/posts/a%2Fb%3Fc';
    await api.getPost(id);
    await api.updatePost(id, { title: 't', slug: 's', summary: '', body: '', tags: [], coverUrl: null, coverAlt: null });
    await api.publishPost(id);
    await api.unpublishPost(id);
    await api.createTranslation(id, 'en');
    await api.listRevisions(id);
    await api.getRevision(id, 'r/1');
    await api.restoreRevision(id, 'r/1');
    await api.schedulePost(id, '2030-01-01T10:00:00-03:00');
    await api.unschedulePost(id);
    respond = () => new Response(null, { status: 204 });
    await api.deletePost(id);
    assert.deepEqual(
      calls.map((call) => `${call.init.method} ${call.url}`),
      [
        `GET ${base}`,
        `PUT ${base}`,
        `POST ${base}/publish`,
        `POST ${base}/unpublish`,
        `POST ${base}/translations`,
        `GET ${base}/revisions`,
        `GET ${base}/revisions/r%2F1`,
        `POST ${base}/revisions/r%2F1/restore`,
        `PUT ${base}/schedule`,
        `DELETE ${base}/schedule`,
        `DELETE ${base}`,
      ],
    );
  });
});

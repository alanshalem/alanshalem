import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { api, ApiError } from '../src/api/client.ts';

/* Contrato HTTP de los videos del hero (L13), con un fetch falso: ruta, método, cuerpo y respuesta. */

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
  it('POST multipart a /api/admin/media/videos y devuelve el VideoAsset del 202', async () => {
    respond = () => json(202, processing);
    const file = new File(['x'], 'mar.mp4', { type: 'video/mp4' });

    assert.deepEqual(await api.uploadVideo(file), processing);

    const [call] = calls;
    assert.equal(call?.url, '/api/admin/media/videos');
    assert.equal(call?.init.method, 'POST');
    assert.ok(call?.init.body instanceof FormData);
    assert.equal(((call.init.body as FormData).get('file') as File).name, 'mar.mp4');
  });

  it('sin edición no envía campos de recorte (la API aplica los defaults de L19)', async () => {
    respond = () => json(202, processing);
    await api.uploadVideo(new File(['x'], 'mar.mp4', { type: 'video/mp4' }));
    const form = calls[0]?.init.body as FormData;
    assert.deepEqual([...form.keys()], ['file']);
  });

  it('con edición suma trimStart, trimEnd, fade y fadeSeconds (L19), con punto decimal', async () => {
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

  it('un 400 llega como ApiError con el detail del ProblemDetails', async () => {
    respond = () => json(400, { title: 'Datos inválidos', detail: 'Dura 20 s: el máximo es 15 s.' });
    await assert.rejects(api.uploadVideo(new File(['x'], 'a.mp4')), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, 'Dura 20 s: el máximo es 15 s.');
      return true;
    });
  });
});

describe('api.uploadMedia (comparte el armado del multipart con los videos)', () => {
  it('sigue haciendo POST del archivo a /api/admin/media', async () => {
    respond = () => json(201, { id: 'm1', url: '/media/h/1600.webp' });
    assert.equal(await api.uploadImage(new File(['x'], 'luna.jpg', { type: 'image/jpeg' })), '/media/h/1600.webp');
    assert.equal(calls[0]?.url, '/api/admin/media');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal(((calls[0]?.init.body as FormData).get('file') as File).name, 'luna.jpg');
  });
});

describe('api.getVideo', () => {
  it('GET /api/admin/media/videos/{id} con el id escapado', async () => {
    respond = () => json(200, { ...processing, status: 'ready' });
    assert.equal((await api.getVideo('a/b')).status, 'ready');
    assert.equal(calls[0]?.url, '/api/admin/media/videos/a%2Fb');
    assert.equal(calls[0]?.init.method, 'GET');
  });
});

describe('api.createHeroImage', () => {
  it('video listo: envía { videoId, alt, credit }', async () => {
    respond = () => json(201, {});
    await api.createHeroImage({ videoId: 'v1' }, { alt: 'Olas', credit: null, altEn: null, creditEn: null });
    assert.equal(calls[0]?.url, '/api/admin/hero-images');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { videoId: 'v1', alt: 'Olas', credit: null, altEn: null, creditEn: null });
  });

  it('foto: sigue enviando { mediaId, alt, credit }', async () => {
    respond = () => json(201, {});
    await api.createHeroImage({ mediaId: 'm1' }, { alt: 'Luna', credit: 'Foto: Alan', altEn: null, creditEn: null });
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { mediaId: 'm1', alt: 'Luna', credit: 'Foto: Alan', altEn: null, creditEn: null });
  });
});

/* Versiones por idioma (L4): el idioma solo viaja al crear; "Crear versión" es su propio endpoint. */

describe('api.createPost / api.updatePost: el idioma solo al crear', () => {
  const input = { title: 'Hola', slug: '', summary: '', body: 'Texto', tags: [], coverUrl: null, coverAlt: null };

  it('POST /api/admin/posts suma el idioma elegido', async () => {
    respond = () => json(201, {});
    await api.createPost(input, 'en');
    assert.equal(calls[0]?.url, '/api/admin/posts');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { ...input, lang: 'en' });
  });

  it('PUT no envía idioma (no se puede cambiar el de un post existente)', async () => {
    respond = () => json(200, {});
    await api.updatePost('p1', input);
    assert.equal(calls[0]?.url, '/api/admin/posts/p1');
    assert.equal(calls[0]?.init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), input);
  });
});

describe('api.createTranslation', () => {
  it('POST /api/admin/posts/{id}/translations con { lang } y devuelve el borrador del 201', async () => {
    const draft = { id: 'p2', lang: 'en', status: 'draft' };
    respond = () => json(201, draft);
    assert.deepEqual(await api.createTranslation('a/b', 'en'), draft);
    assert.equal(calls[0]?.url, '/api/admin/posts/a%2Fb/translations');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { lang: 'en' });
    assert.equal((calls[0]?.init.headers as Record<string, string>)['X-Requested-With'], 'blog-admin');
  });

  it('un 409 llega como ApiError con el mensaje de la API', async () => {
    respond = () => json(409, { title: 'Conflicto', detail: 'Ya existe la versión en inglés.' });
    await assert.rejects(api.createTranslation('p1', 'en'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message, 'Ya existe la versión en inglés.');
      return true;
    });
  });
});

describe('api.createHeroImage / api.updateHeroImage: textos en inglés (L4)', () => {
  it('envía altEn y creditEn junto a los de español', async () => {
    respond = () => json(201, {});
    const input = { alt: 'Luna', credit: null, altEn: 'Moon', creditEn: 'Photo: Alan' };
    await api.createHeroImage({ mediaId: 'm1' }, input);
    assert.deepEqual(JSON.parse(calls[0]?.init.body as string), { mediaId: 'm1', ...input });
    await api.updateHeroImage('h1', input);
    assert.equal(calls[1]?.init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1]?.init.body as string), input);
  });
});

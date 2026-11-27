import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HeroImage, VideoAsset } from '../src/api/types.ts';
import {
  heroItemKind,
  heroMediaKind,
  pollDelay,
  previewSourceUrl,
  VIDEO_ACCEPT,
  videoProgress,
  videoWarnings,
} from '../src/hero/heroVideo.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

const es = i18nFor('es');
const en = i18nFor('en');

/* Videos del hero (L13): a qué flujo va cada archivo, cada cuánto consultar el proceso y qué fuente previsualizar. */

const video = (overrides: Partial<VideoAsset> = {}): VideoAsset => ({
  id: 'v1',
  status: 'ready',
  error: null,
  width: 1920,
  height: 1080,
  durationSeconds: 10,
  edit: { trimStart: 0, trimEnd: 10, fade: 'loop', fadeSeconds: 1 },
  poster: null,
  sources: [],
  warnings: [],
  createdAt: '2026-11-25T10:00:00Z',
  ...overrides,
});

describe('heroMediaKind: la subida se reparte por tipo MIME', () => {
  it('image/* va al flujo de fotos y video/* al de videos', () => {
    assert.equal(heroMediaKind({ type: 'image/jpeg', name: 'luna.jpg' }), 'photo');
    assert.equal(heroMediaKind({ type: 'image/avif', name: 'x' }), 'photo');
    assert.equal(heroMediaKind({ type: 'video/mp4', name: 'mar.mp4' }), 'video');
    assert.equal(heroMediaKind({ type: 'video/quicktime', name: 'mar.mov' }), 'video');
  });

  it('sin MIME (algunos sistemas no conocen .mkv) decide la extensión de video', () => {
    assert.equal(heroMediaKind({ type: '', name: 'Viaje.MKV' }), 'video');
    assert.equal(heroMediaKind({ type: '', name: 'clip.webm' }), 'video');
    assert.equal(heroMediaKind({ type: '', name: 'notas.txt' }), null);
  });

  it('otros tipos no son del hero', () => {
    assert.equal(heroMediaKind({ type: 'application/pdf', name: 'a.pdf' }), null);
  });

  it('el accept del input lista los MIME y las extensiones de video de L13', () => {
    assert.equal(VIDEO_ACCEPT, 'video/mp4,.mp4,video/quicktime,.mov,video/webm,.webm,video/x-matroska,.mkv');
  });
});

describe('heroItemKind: qué es un ítem guardado', () => {
  it('con video es un video (su `media` es el póster); sin video, una foto', () => {
    const item = { video: null } as HeroImage;
    assert.equal(heroItemKind(item), 'photo');
    assert.equal(heroItemKind({ ...item, video: video() }), 'video');
  });
});

describe('pollDelay: espera creciente con tope', () => {
  it('empieza en 2 s, crece ×1,5 y no pasa de 15 s', () => {
    assert.deepEqual([0, 1, 2, 3].map(pollDelay), [2000, 3000, 4500, 6750]);
    assert.equal(pollDelay(10), 15000);
    assert.equal(pollDelay(100), 15000);
  });
});

describe('videoProgress: estado del archivo pendiente según el video', () => {
  it('processing y ready', () => {
    assert.deepEqual(videoProgress(video({ status: 'processing' }), es), { status: 'processing', error: null });
    assert.deepEqual(videoProgress(video({ status: 'ready' }), es), { status: 'uploaded', error: null });
  });

  it('failed: el error de la API o, si no vino, uno genérico', () => {
    assert.deepEqual(videoProgress(video({ status: 'failed', error: 'ffmpeg: códec no soportado' }), es), {
      status: 'failed',
      error: 'ffmpeg: códec no soportado',
    });
    assert.deepEqual(videoProgress(video({ status: 'failed', error: null }), es), {
      status: 'failed',
      error: 'No se pudo procesar el video.',
    });
    assert.deepEqual(videoProgress(video({ status: 'failed', error: null }), en), {
      status: 'failed',
      error: 'Couldn’t process the video.',
    });
  });
});

describe('videoWarnings: the size warning comes from the admin rule, in the UI language', () => {
  // What the API sends in `warnings` (in whatever language it answered): the admin does not show it.
  const apiWarning = 'Mide 1280×720, menos que lo ideal (1920×1080): puede perder nitidez en pantallas grandes.';

  it('an English admin sees the English below-ideal warning, whatever text the API sent', () => {
    assert.deepEqual(videoWarnings(video({ width: 1280, height: 720, warnings: [apiWarning] }), en), [
      'It’s 1280×720, below the ideal (1920×1080): it may look soft on large screens.',
    ]);
  });

  it('a Spanish admin sees the same rule in Spanish', () => {
    assert.deepEqual(videoWarnings(video({ width: 1600, height: 900 }), es), [
      'Mide 1600×900, menos que lo ideal (1920×1080): puede perder nitidez en pantallas grandes.',
    ]);
  });

  it('the ideal size or larger: no warning, even if the API sent one', () => {
    assert.deepEqual(videoWarnings(video({ width: 1920, height: 1080, warnings: [apiWarning] }), en), []);
    assert.deepEqual(videoWarnings(video({ width: 3840, height: 2160 }), es), []);
  });
});

describe('previewSourceUrl: la H.264 más liviana (la que reproduce cualquier navegador)', () => {
  it('elige la H.264 de 720p aunque haya AV1 y 1080p', () => {
    const sources = [
      { codec: 'av1', height: 720, url: '/media/videos/h/720.av1.mp4', bytes: 1 },
      { codec: 'h264', height: 1080, url: '/media/videos/h/1080.h264.mp4', bytes: 3 },
      { codec: 'h264', height: 720, url: '/media/videos/h/720.h264.mp4', bytes: 2 },
    ] as const;
    assert.equal(previewSourceUrl(video({ sources: [...sources] })), '/media/videos/h/720.h264.mp4');
  });

  it('sin H.264 (todavía procesando o falló): no hay vista previa en movimiento', () => {
    assert.equal(previewSourceUrl(video({ sources: [] })), null);
    assert.equal(previewSourceUrl(video({ sources: [{ codec: 'av1', height: 720, url: '/a', bytes: 1 }] })), null);
  });
});

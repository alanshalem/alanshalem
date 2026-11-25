import type { HeroImage, VideoAsset } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';

/* Reglas puras de los videos del hero (L13): qué archivos son videos, cada cuánto consultar y qué previsualizar. */

export type HeroMediaKind = 'photo' | 'video';

// Los contenedores que acepta la API (L13). Una sola lista arma el `accept` del input y el respaldo por extensión.
const VIDEO_FORMATS = [
  { mime: 'video/mp4', extension: '.mp4' },
  { mime: 'video/quicktime', extension: '.mov' },
  { mime: 'video/webm', extension: '.webm' },
  { mime: 'video/x-matroska', extension: '.mkv' },
] as const;

export const VIDEO_ACCEPT = VIDEO_FORMATS.flatMap(({ mime, extension }) => [mime, extension]).join(',');

/**
 * A qué flujo va un archivo, según su tipo MIME. Algunos sistemas no conocen el MIME de .mkv y lo dejan vacío:
 * ahí decide la extensión. Lo demás no es del hero (la API igual lo rechazaría).
 */
export function heroMediaKind(file: { type: string; name: string }): HeroMediaKind | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  const name = file.name.toLowerCase();
  if (file.type === '' && VIDEO_FORMATS.some(({ extension }) => name.endsWith(extension))) return 'video';
  return null;
}

/** Un ítem guardado es un video si trae `video` (su `media` es el póster); si no, una foto. */
export const heroItemKind = (image: HeroImage): HeroMediaKind => (image.video ? 'video' : 'photo');

// Un video de 15 s tarda de segundos a minutos (AV1 es lento): consultar seguido al principio y espaciar después.
const POLL = { firstMs: 2000, factor: 1.5, maxMs: 15000 } as const;

/** Espera antes de la consulta número `attempt` (desde 0). */
export const pollDelay = (attempt: number): number => Math.min(POLL.firstMs * POLL.factor ** attempt, POLL.maxMs);

/** Estado del archivo pendiente que corresponde al estado del video en la API (su error, si vino, tal cual). */
export function videoProgress(
  video: VideoAsset,
  i18n: I18n,
): { status: 'processing' | 'uploaded' | 'failed'; error: string | null } {
  switch (video.status) {
    case 'processing':
      return { status: 'processing', error: null };
    case 'ready':
      return { status: 'uploaded', error: null };
    case 'failed':
      return { status: 'failed', error: video.error ?? i18n.t('hero.videoFailed') };
  }
}

/** La fuente H.264 más liviana: cualquier navegador la reproduce y alcanza para una miniatura en movimiento. */
export function previewSourceUrl(video: VideoAsset): string | null {
  const h264 = video.sources.filter((source) => source.codec === 'h264');
  if (h264.length === 0) return null;
  return h264.reduce((lightest, source) => (source.height < lightest.height ? source : lightest)).url;
}

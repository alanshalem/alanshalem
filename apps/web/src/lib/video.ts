import { htmlAttributes } from './html.ts';
import type { MediaAsset } from './media.ts';

/** Videos procesados por la API (L13): sin audio, AV1 + H.264 en MP4, 720p y 1080p (nunca agrandados). Todo puro. */
export type VideoCodec = 'av1' | 'h264';
export type VideoHeight = 720 | 1080;

export interface VideoSource {
  codec: VideoCodec;
  height: VideoHeight;
  url: string;
  bytes: number;
}

/** VideoAssetDto (L13). La galería del sitio solo recibe videos en `ready`. */
export interface VideoAsset {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  poster: MediaAsset | null;
  sources: VideoSource[];
  warnings: string[];
  createdAt: string;
}

/**
 * `type` exacto de lo que escriben libsvtav1 y libx264 (high, yuv420p) con nivel automático, verificado leyendo
 * las cajas av1C/avcC de su salida: AV1 Main 8 bits nivel 3.1 / 4.0 y H.264 High nivel 3.1 / 4.0 (a ≤ 30 fps
 * y 16:9 el nivel depende solo del alto). El navegador saltea sin descargar la fuente
 * que no puede decodificar; declarar el nivel real evita descartar 720p en equipos que no llegan a 4.0.
 */
const SOURCE_TYPES: Record<VideoCodec, Record<VideoHeight, string>> = {
  av1: { 720: 'video/mp4; codecs="av01.0.05M.08"', 1080: 'video/mp4; codecs="av01.0.08M.08"' },
  h264: { 720: 'video/mp4; codecs="avc1.64001f"', 1080: 'video/mp4; codecs="avc1.640028"' },
};

/** AV1 primero: pesa bastante menos a igual calidad; H.264 queda de respaldo (Safari viejo, equipos sin AV1). */
const CODEC_PREFERENCE: readonly VideoCodec[] = ['av1', 'h264'];

/**
 * El navegador usa la primera <source> que puede reproducir y cuyo `media` coincide (S10: cada dispositivo
 * baja solo lo que le sirve). 720p (1280 px de ancho) alcanza para celulares y tablets en vertical;
 * desde 1024 px de viewport (tablets apaisadas, notebooks, escritorio) va 1080p.
 */
const FULL_HD_MEDIA = '(min-width: 1024px)';

/** Por códec preferido y, dentro de cada uno, la más grande primero (la más chica no lleva `media`: es el piso). */
const byPreference = (a: VideoSource, b: VideoSource): number =>
  CODEC_PREFERENCE.indexOf(a.codec) - CODEC_PREFERENCE.indexOf(b.codec) || b.height - a.height;

const sourceTag = ({ codec, height, url }: VideoSource): string =>
  `<source${htmlAttributes({
    src: url,
    type: SOURCE_TYPES[codec][height],
    // Solo 1080p se condiciona: 720p es el piso del pipeline y sirve en cualquier pantalla.
    media: height === 1080 ? FULL_HD_MEDIA : undefined,
  })}>`;

/** Las <source> de un video, en el orden en que el navegador debe probarlas. */
export const videoSourcesHtml = (video: VideoAsset): string =>
  [...video.sources].sort(byPreference).map(sourceTag).join('');

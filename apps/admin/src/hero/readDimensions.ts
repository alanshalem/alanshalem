import type { MediaDimensions } from './heroSize.ts';
import type { HeroMediaKind } from './heroVideo.ts';

// Un archivo local responde en milisegundos; si el navegador no termina de leerlo, mejor dejar que decida la API.
const READ_TIMEOUT_MS = 5000;

/**
 * Medidas del archivo local, para aplicar la regla de tamaño antes de subirlo. `null` si el navegador no puede
 * leerlo (HEVC, MKV en algunos navegadores, una foto rara): ese archivo se sube igual y lo valida la API.
 */
export async function readDimensions(file: File, kind: HeroMediaKind): Promise<MediaDimensions | null> {
  const url = URL.createObjectURL(file);
  try {
    const read = kind === 'photo' ? readImage(url) : readVideo(url);
    const dimensions = await Promise.race([read, timeout()]);
    return dimensions.width > 0 && dimensions.height > 0 ? dimensions : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readImage(url: string): Promise<MediaDimensions> {
  const image = new Image();
  const loaded = settled(image, 'load');
  image.src = url;
  await loaded;
  // naturalWidth/Height ya respetan la orientación EXIF, igual que la API al autorrotar.
  return { width: image.naturalWidth, height: image.naturalHeight };
}

async function readVideo(url: string): Promise<MediaDimensions> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  const loaded = settled(video, 'loadedmetadata');
  video.src = url;
  try {
    await loaded;
    // Algunos WebM grabados en el navegador declaran duración infinita: esa la mide la API con ffprobe.
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    return { width: video.videoWidth, height: video.videoHeight, durationSeconds: duration };
  } finally {
    // Suelta el archivo: un <video> fuera del DOM igual retiene el decodificador hasta que se le quita la fuente.
    video.removeAttribute('src');
    video.load();
  }
}

function settled(element: HTMLElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    element.addEventListener(event, () => resolve(), { once: true });
    element.addEventListener('error', () => reject(new Error('No se pudo leer el archivo.')), { once: true });
  });
}

function timeout(): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo agotado.')), READ_TIMEOUT_MS));
}

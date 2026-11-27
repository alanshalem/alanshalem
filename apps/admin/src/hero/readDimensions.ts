import type { MediaDimensions } from './heroSize.ts';
import type { HeroMediaKind } from './heroVideo.ts';

// A local file answers in milliseconds; if the browser does not finish reading it, better to let the API decide.
const READ_TIMEOUT_MS = 5000;

/**
 * Sizes of the local file, to apply the size rule before uploading it. `null` if the browser cannot read it (HEVC,
 * MKV in some browsers, an odd photo): that file is uploaded anyway and the API validates it.
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
  // naturalWidth/Height already honor the EXIF orientation, like the API when it auto-rotates.
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
    // Some WebM files recorded in the browser declare an infinite duration: the API measures it with ffprobe.
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    return { width: video.videoWidth, height: video.videoHeight, durationSeconds: duration };
  } finally {
    // Release the file: a <video> outside the DOM still holds the decoder until its source is removed.
    video.removeAttribute('src');
    video.load();
  }
}

function settled(element: HTMLElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    element.addEventListener(event, () => resolve(), { once: true });
    element.addEventListener('error', () => reject(new Error('Could not read the file.')), { once: true });
  });
}

function timeout(): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out.')), READ_TIMEOUT_MS));
}

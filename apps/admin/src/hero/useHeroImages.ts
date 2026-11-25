import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { HeroImage, HeroImageInput, HeroMediaRef, MediaAsset, VideoAsset } from '../api/types.ts';
import { inUploadOrder } from './heroImage.ts';
import { checkHeroSize } from './heroSize.ts';
import { heroItemKind, heroMediaKind, pollDelay, UNSUPPORTED_FILE, videoProgress, type HeroMediaKind } from './heroVideo.ts';
import { readDimensions } from './readDimensions.ts';

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'uploaded' | 'failed';

/** Un archivo elegido que todavía no es un ítem del hero: falta subirlo (y procesarlo) y/o describirlo. */
export interface PendingUpload {
  key: number;
  /** `null` = un archivo que no es foto ni video (queda como error para que se vea qué pasó). */
  kind: HeroMediaKind | null;
  fileName: string;
  /** URL local (blob:) de una foto, para verla antes de que termine de subir. Los videos se ven ya procesados. */
  previewUrl: string | null;
  status: UploadStatus;
  media: MediaAsset | null;
  video: VideoAsset | null;
  /** Avisos que no impiden guardar: primero el del chequeo local; los del video, cuando responde la API. */
  warnings: string[];
  error: string | null;
}

const REBUILD_NOTE = 'El sitio se está regenerando.';
const NOTICES = {
  photo: { added: 'Foto agregada.', deleted: 'Foto eliminada.' },
  video: { added: 'Video agregado.', deleted: 'Video eliminado.' },
} as const;

const errorText = (caught: unknown): string => (caught instanceof Error ? caught.message : 'Error desconocido.');

/** El asset al que se asocia el texto: solo existe cuando la foto subió o el video quedó listo. */
const mediaRefOf = ({ media, video }: PendingUpload): HeroMediaRef | null =>
  video?.status === 'ready' ? { videoId: video.id } : media ? { mediaId: media.id } : null;

/**
 * Estado de la galería del hero: ítems guardados, archivos en curso y las llamadas a la API.
 * Las acciones que guardan o borran rechazan con el error de la API para que la tarjeta lo muestre;
 * antes avisan a `onError`, que se ocupa de la sesión vencida.
 */
export function useHeroImages(onError: (error: unknown) => boolean) {
  const [images, setImages] = useState<HeroImage[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nextKey = useRef(0);
  // La API optimiza de a una imagen por vez: subir en fila mantiene un "En cola / Subiendo" honesto por archivo.
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const dropped = useRef(new Set<number>());
  // Consultas programadas del estado de cada video, para cortarlas al descartar o al salir de la página.
  const pollTimers = useRef(new Map<number, number>());
  const mounted = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    api
      .listHeroImages()
      .then((list) => setImages(inUploadOrder(list)))
      .catch((caught: unknown) => {
        if (!onError(caught)) setLoadError(`No se pudieron cargar las fotos y videos del hero: ${errorText(caught)}`);
      })
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    mounted.current = true; // StrictMode desmonta y vuelve a montar: se reactiva acá, no al declarar el ref.
    const timers = pollTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      // Las URLs blob: ocupan memoria hasta que se liberan.
      pendingRef.current.forEach((upload) => upload.previewUrl && URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  const patchPending = (key: number, patch: Partial<PendingUpload>): void =>
    setPending((list) => list.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)));

  const dropPending = (pendingUpload: PendingUpload): void => {
    if (pendingUpload.previewUrl) URL.revokeObjectURL(pendingUpload.previewUrl);
    window.clearTimeout(pollTimers.current.get(pendingUpload.key));
    pollTimers.current.delete(pendingUpload.key);
    dropped.current.add(pendingUpload.key);
    setPending((list) => list.filter((upload) => upload.key !== pendingUpload.key));
  };

  const reportingErrors = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (caught) {
        onError(caught);
        throw caught;
      }
    },
    [onError],
  );

  const failUnlessHandled = useCallback(
    (key: number, caught: unknown, prefix = ''): void => {
      if (mounted.current && !onError(caught)) patchPending(key, { status: 'failed', error: prefix + errorText(caught) });
    },
    [onError],
  );

  // Refleja el estado del video y, mientras la API lo procesa, vuelve a consultar con espera creciente.
  const trackVideo = useCallback(
    function track(key: number, video: VideoAsset, attempt: number): void {
      if (!mounted.current || dropped.current.has(key)) return;
      const progress = videoProgress(video);
      patchPending(key, { ...progress, video, warnings: video.warnings });
      if (progress.status !== 'processing') return;

      const timer = window.setTimeout(() => {
        pollTimers.current.delete(key);
        api.getVideo(video.id).then(
          (next) => track(key, next, attempt + 1),
          (caught: unknown) => failUnlessHandled(key, caught, 'No se pudo consultar el estado del video: '),
        );
      }, pollDelay(attempt));
      pollTimers.current.set(key, timer);
    },
    [failUnlessHandled],
  );

  // Regla de tamaño antes de subir (S10, S12). Si el navegador no puede leer el archivo, decide la API.
  const precheck = useCallback(async (key: number, file: File, kind: HeroMediaKind): Promise<boolean> => {
    const dimensions = await readDimensions(file, kind);
    if (!dimensions) return true;
    const check = checkHeroSize(dimensions);
    if (!check.ok) {
      patchPending(key, { status: 'failed', error: check.error });
      return false;
    }
    if (check.warning) patchPending(key, { warnings: [check.warning] });
    return true;
  }, []);

  const upload = useCallback(
    async (key: number, file: File, kind: HeroMediaKind): Promise<void> => {
      // Descartado mientras esperaba en la fila: no tiene sentido subirlo.
      if (dropped.current.has(key)) return;
      patchPending(key, { status: 'uploading' });
      try {
        if (kind === 'photo') patchPending(key, { status: 'uploaded', media: await api.uploadMedia(file) });
        else trackVideo(key, await api.uploadVideo(file), 0);
      } catch (caught) {
        failUnlessHandled(key, caught);
      }
    },
    [failUnlessHandled, trackVideo],
  );

  const addFiles = useCallback(
    (files: readonly File[]): void => {
      const entries = files.map((file): [File, PendingUpload] => {
        const kind = heroMediaKind(file);
        return [
          file,
          {
            key: nextKey.current++,
            kind,
            fileName: file.name,
            previewUrl: kind === 'photo' ? URL.createObjectURL(file) : null,
            status: kind ? 'queued' : 'failed',
            media: null,
            video: null,
            warnings: [],
            error: kind ? null : UNSUPPORTED_FILE,
          },
        ];
      });
      setPending((list) => [...list, ...entries.map(([, entry]) => entry)]);
      for (const [file, { key, kind }] of entries) {
        if (!kind) continue;
        // El chequeo local arranca ya (un rechazo se ve sin esperar la fila); la subida respeta el orden.
        const accepted = precheck(key, file, kind);
        uploadQueue.current = uploadQueue.current.then(async () => {
          if (await accepted) await upload(key, file, kind);
        });
      }
    },
    [precheck, upload],
  );

  const savePending = async (pendingUpload: PendingUpload, input: HeroImageInput): Promise<void> => {
    const ref = mediaRefOf(pendingUpload);
    if (!ref) return;
    const image = await reportingErrors(() => api.createHeroImage(ref, input));
    dropPending(pendingUpload);
    setImages((list) => [...list, image]);
    setNotice(`${NOTICES[heroItemKind(image)].added} ${REBUILD_NOTE}`);
  };

  const discardPending = (pendingUpload: PendingUpload): void => {
    dropPending(pendingUpload);
    setNotice(`Descartada: ${pendingUpload.fileName}.`);
  };

  const updateImage = async (id: string, input: HeroImageInput): Promise<void> => {
    const image = await reportingErrors(() => api.updateHeroImage(id, input));
    setImages((list) => list.map((current) => (current.id === id ? image : current)));
    setNotice(`Cambios guardados. ${REBUILD_NOTE}`);
  };

  const deleteImage = async (image: HeroImage): Promise<void> => {
    await reportingErrors(() => api.deleteHeroImage(image.id));
    setImages((list) => list.filter((current) => current.id !== image.id));
    setNotice(`${NOTICES[heroItemKind(image)].deleted} ${REBUILD_NOTE}`);
  };

  return { images, pending, loading, loadError, notice, addFiles, savePending, discardPending, updateImage, deleteImage };
}

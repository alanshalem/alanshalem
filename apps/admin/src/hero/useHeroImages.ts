import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage } from '../api/problem.ts';
import type { HeroImage, HeroImageInput, HeroMediaRef, MediaAsset, VideoAsset, VideoEdit } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { inUploadOrder } from './heroImage.ts';
import { checkHeroSize } from './heroSize.ts';
import { heroItemKind, heroMediaKind, pollDelay, videoProgress, videoWarnings, type HeroMediaKind } from './heroVideo.ts';
import { readDimensions } from './readDimensions.ts';
import { checkVideoDuration } from './videoEdit.ts';

/** `editing` = un video local esperando que se elija el tramo y el fundido (L19): todavía no entró a la fila. */
export type UploadStatus = 'editing' | 'queued' | 'uploading' | 'processing' | 'uploaded' | 'failed';

/** Un archivo elegido que todavía no es un ítem del hero: falta subirlo (y procesarlo) y/o describirlo. */
export interface PendingUpload {
  key: number;
  /** `null` = un archivo que no es foto ni video (queda como error para que se vea qué pasó). */
  kind: HeroMediaKind | null;
  fileName: string;
  /** URL local (blob:) del archivo: la foto se ve antes de que termine de subir; el video, en el editor de recorte. */
  previewUrl: string | null;
  /** Duración del video local; con ella se abre el editor. `null` en fotos o si el navegador no pudo leerla. */
  durationSeconds: number | null;
  status: UploadStatus;
  media: MediaAsset | null;
  video: VideoAsset | null;
  /**
   * Non-blocking warnings, always from the admin's size rule in the UI language: first from the local precheck, then
   * (videos) from the size the API measured (`videoWarnings`), never the API's own `warnings` text.
   */
  warnings: string[];
  error: string | null;
}

/** Qué sigue después del chequeo local: subir ya, abrir el editor (videos) o nada (rechazado, el error ya está). */
type PrecheckOutcome = 'upload' | 'edit' | 'rejected';

/** El asset al que se asocia el texto: solo existe cuando la foto subió o el video quedó listo. */
const mediaRefOf = ({ media, video }: PendingUpload): HeroMediaRef | null =>
  video?.status === 'ready' ? { videoId: video.id } : media ? { mediaId: media.id } : null;

/**
 * Estado de la galería del hero: ítems guardados, archivos en curso y las llamadas a la API.
 * Las acciones que guardan o borran rechazan con el error de la API para que la tarjeta lo muestre;
 * antes avisan a `onError`, que se ocupa de la sesión vencida. Los mensajes quedan en el idioma de la interfaz del
 * momento en que se produjeron (no se retraducen si se cambia de idioma con una subida en curso).
 */
export function useHeroImages(onError: (error: unknown) => boolean) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const [images, setImages] = useState<HeroImage[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nextKey = useRef(0);
  // La API optimiza de a una imagen por vez: subir en fila mantiene un "En cola / Subiendo" honesto por archivo.
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  // Videos abiertos en el editor: el File queda acá (no en el estado) hasta que se confirma el tramo.
  const filesToEdit = useRef(new Map<number, File>());
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
        if (!onError(caught)) setLoadError(t('hero.loadError', { error: errorMessage(caught, t('error.unknownSentence')) }));
      })
      .finally(() => setLoading(false));
    // Without `t`: switching the UI language does not fetch the gallery again.
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
    filesToEdit.current.delete(pendingUpload.key);
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

  /** `describe` envuelve el error con su contexto ("No se pudo consultar…: {error}"); sin él, va el error solo. */
  const failUnlessHandled = useCallback(
    (key: number, caught: unknown, describe = (error: string) => error): void => {
      if (mounted.current && !onError(caught)) {
        patchPending(key, { status: 'failed', error: describe(errorMessage(caught, t('error.unknownSentence'))) });
      }
    },
    [onError, t],
  );

  // Refleja el estado del video y, mientras la API lo procesa, vuelve a consultar con espera creciente.
  const trackVideo = useCallback(
    function track(key: number, video: VideoAsset, attempt: number): void {
      if (!mounted.current || dropped.current.has(key)) return;
      const progress = videoProgress(video, i18n);
      patchPending(key, { ...progress, video, warnings: videoWarnings(video, i18n) });
      if (progress.status !== 'processing') return;

      const timer = window.setTimeout(() => {
        pollTimers.current.delete(key);
        api.getVideo(video.id).then(
          (next) => track(key, next, attempt + 1),
          (caught: unknown) => failUnlessHandled(key, caught, (error) => t('hero.pollError', { error })),
        );
      }, pollDelay(attempt));
      pollTimers.current.set(key, timer);
    },
    [failUnlessHandled, i18n, t],
  );

  /*
   * Chequeo local antes de subir. El tamaño (S10) se rechaza ya: recortar no lo arregla. Un video legible, en
   * cambio, abre el editor (S13) aunque dure más de 15 s. Si el navegador no puede leer el archivo (o la duración
   * de un WebM grabado en el navegador), se sube tal cual y decide la API con sus defaults de L19.
   */
  const precheck = useCallback(
    async (key: number, file: File, kind: HeroMediaKind): Promise<PrecheckOutcome> => {
      const dimensions = await readDimensions(file, kind);
      if (!dimensions) return 'upload';
      const reject = (error: string): PrecheckOutcome => {
        patchPending(key, { status: 'failed', error });
        return 'rejected';
      };

      const check = checkHeroSize(dimensions, i18n);
      if (!check.ok) return reject(check.error);
      if (check.warning) patchPending(key, { warnings: [check.warning] });

      const { durationSeconds } = dimensions;
      if (kind === 'photo' || durationSeconds === undefined) return 'upload';
      const tooShort = checkVideoDuration(durationSeconds, i18n);
      if (tooShort) return reject(tooShort);

      filesToEdit.current.set(key, file);
      patchPending(key, { status: 'editing', durationSeconds });
      return 'edit';
    },
    [i18n],
  );

  const upload = useCallback(
    async (key: number, file: File, kind: HeroMediaKind, edit?: VideoEdit): Promise<void> => {
      // Descartado mientras esperaba en la fila: no tiene sentido subirlo.
      if (dropped.current.has(key)) return;
      patchPending(key, { status: 'uploading' });
      try {
        if (kind === 'photo') patchPending(key, { status: 'uploaded', media: await api.uploadMedia(file) });
        else trackVideo(key, await api.uploadVideo(file, edit), 0);
      } catch (caught) {
        failUnlessHandled(key, caught);
      }
    },
    [failUnlessHandled, trackVideo],
  );

  const enqueue = (task: () => Promise<void>): void => {
    uploadQueue.current = uploadQueue.current.then(task);
  };

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
            previewUrl: kind ? URL.createObjectURL(file) : null,
            durationSeconds: null,
            status: kind ? 'queued' : 'failed',
            media: null,
            video: null,
            warnings: [],
            error: kind ? null : t('hero.unsupportedFile'),
          },
        ];
      });
      setPending((list) => [...list, ...entries.map(([, entry]) => entry)]);
      for (const [file, { key, kind }] of entries) {
        if (!kind) continue;
        // El chequeo local arranca ya (un rechazo o el editor se ven sin esperar la fila); la subida respeta el
        // orden. Un video en el editor no frena la fila: entra recién al confirmar (`uploadEdited`).
        const outcome = precheck(key, file, kind);
        enqueue(async () => {
          if ((await outcome) === 'upload') await upload(key, file, kind);
        });
      }
    },
    [precheck, upload, t],
  );

  /** Confirma el tramo y el fundido de un video del editor y lo pone en la fila de subida. */
  const uploadEdited = (pendingUpload: PendingUpload, edit: VideoEdit): void => {
    const file = filesToEdit.current.get(pendingUpload.key);
    if (!file) return;
    filesToEdit.current.delete(pendingUpload.key);
    patchPending(pendingUpload.key, { status: 'queued' });
    enqueue(() => upload(pendingUpload.key, file, 'video', edit));
  };

  const savePending = async (pendingUpload: PendingUpload, input: HeroImageInput): Promise<void> => {
    const ref = mediaRefOf(pendingUpload);
    if (!ref) return;
    const image = await reportingErrors(() => api.createHeroImage(ref, input));
    dropPending(pendingUpload);
    setImages((list) => [...list, image]);
    setNotice(`${t(`hero.added.${heroItemKind(image)}`)} ${t('hero.rebuilding')}`);
  };

  const discardPending = (pendingUpload: PendingUpload): void => {
    dropPending(pendingUpload);
    setNotice(t('hero.discarded', { name: pendingUpload.fileName }));
  };

  const updateImage = async (id: string, input: HeroImageInput): Promise<void> => {
    const image = await reportingErrors(() => api.updateHeroImage(id, input));
    setImages((list) => list.map((current) => (current.id === id ? image : current)));
    setNotice(`${t('hero.changesSaved')} ${t('hero.rebuilding')}`);
  };

  const deleteImage = async (image: HeroImage): Promise<void> => {
    await reportingErrors(() => api.deleteHeroImage(image.id));
    setImages((list) => list.filter((current) => current.id !== image.id));
    setNotice(`${t(`hero.deleted.${heroItemKind(image)}`)} ${t('hero.rebuilding')}`);
  };

  return {
    images,
    pending,
    loading,
    loadError,
    notice,
    addFiles,
    uploadEdited,
    savePending,
    discardPending,
    updateImage,
    deleteImage,
  };
}

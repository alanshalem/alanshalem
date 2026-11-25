import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { HeroImage, HeroImageInput, MediaAsset } from '../api/types.ts';
import { inUploadOrder } from './heroImage.ts';

export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

/** Un archivo elegido que todavía no es una foto del hero: falta subirlo y/o completar su texto alternativo. */
export interface PendingUpload {
  key: number;
  fileName: string;
  /** URL local (blob:) para ver el archivo antes de que termine de subir. */
  previewUrl: string;
  status: UploadStatus;
  media: MediaAsset | null;
  error: string | null;
}

const REBUILD_NOTE = 'El sitio se está regenerando.';

const errorText = (caught: unknown): string => (caught instanceof Error ? caught.message : 'Error desconocido.');

/**
 * Estado de la galería del hero: fotos guardadas, archivos en curso y las llamadas a la API.
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
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    api
      .listHeroImages()
      .then((list) => setImages(inUploadOrder(list)))
      .catch((caught: unknown) => {
        if (!onError(caught)) setLoadError(`No se pudieron cargar las fotos del hero: ${errorText(caught)}`);
      })
      .finally(() => setLoading(false));
  }, [onError]);

  // Las URLs blob: ocupan memoria hasta que se liberan.
  useEffect(() => () => pendingRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl)), []);

  const patchPending = (key: number, patch: Partial<PendingUpload>): void =>
    setPending((list) => list.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)));

  const dropPending = (pendingUpload: PendingUpload): void => {
    URL.revokeObjectURL(pendingUpload.previewUrl);
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

  const upload = useCallback(
    async (key: number, file: File): Promise<void> => {
      // Descartada mientras esperaba en la fila: no tiene sentido subirla.
      if (dropped.current.has(key)) return;
      patchPending(key, { status: 'uploading' });
      try {
        patchPending(key, { status: 'uploaded', media: await api.uploadMedia(file) });
      } catch (caught) {
        if (!onError(caught)) patchPending(key, { status: 'failed', error: errorText(caught) });
      }
    },
    [onError],
  );

  const addFiles = useCallback(
    (files: readonly File[]): void => {
      const entries = files.map((file): [File, PendingUpload] => [
        file,
        {
          key: nextKey.current++,
          fileName: file.name,
          previewUrl: URL.createObjectURL(file),
          status: 'queued',
          media: null,
          error: null,
        },
      ]);
      setPending((list) => [...list, ...entries.map(([, entry]) => entry)]);
      for (const [file, { key }] of entries) uploadQueue.current = uploadQueue.current.then(() => upload(key, file));
    },
    [upload],
  );

  const savePending = async (pendingUpload: PendingUpload, input: HeroImageInput): Promise<void> => {
    const media = pendingUpload.media;
    if (!media) return;
    const image = await reportingErrors(() => api.createHeroImage(media.id, input));
    dropPending(pendingUpload);
    setImages((list) => [...list, image]);
    setNotice(`Foto agregada. ${REBUILD_NOTE}`);
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

  const deleteImage = async (id: string): Promise<void> => {
    await reportingErrors(() => api.deleteHeroImage(id));
    setImages((list) => list.filter((current) => current.id !== id));
    setNotice(`Foto eliminada. ${REBUILD_NOTE}`);
  };

  return { images, pending, loading, loadError, notice, addFiles, savePending, discardPending, updateImage, deleteImage };
}

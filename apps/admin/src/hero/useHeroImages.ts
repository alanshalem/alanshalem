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

/** `editing` = a local video waiting for its segment and fade to be chosen: not in the queue yet. */
export type UploadStatus = 'editing' | 'queued' | 'uploading' | 'processing' | 'uploaded' | 'failed';

/** A chosen file that is not a hero item yet: it still has to be uploaded (and processed) and/or described. */
export interface PendingUpload {
  key: number;
  /** `null` = a file that is neither photo nor video (it stays as an error so it is clear what happened). */
  kind: HeroMediaKind | null;
  fileName: string;
  /** Local (blob:) URL of the file: the photo shows before the upload finishes; the video, in the trim editor. */
  previewUrl: string | null;
  /** Duration of the local video; with it the editor opens. `null` for photos or if the browser could not read it. */
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

/** What follows the local check: upload now, open the editor (videos) or nothing (rejected, the error is set). */
type PrecheckOutcome = 'upload' | 'edit' | 'rejected';

/** The asset the text is attached to: it only exists once the photo uploaded or the video is ready. */
const mediaRefOf = ({ media, video }: PendingUpload): HeroMediaRef | null =>
  video?.status === 'ready' ? { videoId: video.id } : media ? { mediaId: media.id } : null;

/**
 * State of the hero gallery: saved items, files in progress and the API calls.
 * The actions that save or delete reject with the API error so the card shows it; first they tell `onError`, which
 * handles an expired session. Messages stay in the UI language of the moment they were produced (they are not
 * re-translated if the language changes during an upload).
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
  // The API optimizes one image at a time: uploading in a queue keeps an honest "En cola / Subiendo" per file.
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  // Videos open in the editor: the File stays here (not in state) until the segment is confirmed.
  const filesToEdit = useRef(new Map<number, File>());
  const dropped = useRef(new Set<number>());
  // Scheduled status polls of each video, so they can be stopped on discard or when leaving the page.
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
    mounted.current = true; // StrictMode unmounts and mounts again: it is re-enabled here, not when declaring the ref.
    const timers = pollTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      // blob: URLs hold memory until they are released.
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

  /** `describe` wraps the error with its context ("No se pudo consultar…: {error}"); without it, the bare error. */
  const failUnlessHandled = useCallback(
    (key: number, caught: unknown, describe = (error: string) => error): void => {
      if (mounted.current && !onError(caught)) {
        patchPending(key, { status: 'failed', error: describe(errorMessage(caught, t('error.unknownSentence'))) });
      }
    },
    [onError, t],
  );

  // Reflects the video status and, while the API processes it, polls again with a growing wait.
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
   * Local check before uploading. A bad size is rejected right away: trimming does not fix it. A readable video, on
   * the other hand, opens the editor even if it lasts more than 15 s. If the browser cannot read the file (or the
   * duration of a WebM recorded in the browser), it is uploaded as is and the API decides with its defaults.
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
      // Discarded while waiting in the queue: no point uploading it.
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
        // The local check starts right away (a rejection or the editor shows without waiting for the queue); the
        // upload keeps the order. A video in the editor does not block the queue: it only joins on confirm
        // (`uploadEdited`).
        const outcome = precheck(key, file, kind);
        enqueue(async () => {
          if ((await outcome) === 'upload') await upload(key, file, kind);
        });
      }
    },
    [precheck, upload, t],
  );

  /** Confirms the segment and fade of a video in the editor and puts it in the upload queue. */
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

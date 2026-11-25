import { useId } from 'react';
import type { VideoEdit } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { FadePicker } from './FadePicker.tsx';
import { TrimTimeline } from './TrimTimeline.tsx';
import { usePrefersReducedMotion, useRangePreview } from './useRangePreview.ts';
import { useVideoEditor } from './useVideoEditor.ts';
import { fadeExplanation } from './videoEdit.ts';

interface Props {
  /** URL local (blob:) del archivo elegido: la vista previa no sube nada. */
  src: string;
  durationSeconds: number;
  onConfirm: (edit: VideoEdit) => void;
}

/**
 * Paso previo a subir un video (S13–S15): elegir el tramo y el fundido sobre el archivo local. El servidor recorta y
 * aplica el fundido al procesar (L19); esto solo elige los parámetros y da una idea del resultado.
 */
export function VideoEditor({ src, durationSeconds, onConfirm }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const editor = useVideoEditor(durationSeconds);
  const reducedMotion = usePrefersReducedMotion();
  const animate = !reducedMotion;
  const preview = useRangePreview(editor.edit, editor.cue, durationSeconds, animate);
  const id = useId();
  const { edit } = editor;

  return (
    <section className="video-editor" aria-labelledby={`${id}-title`}>
      <div className="video-editor-main">
        {/* Un label y no un heading: el editor va antes del título (h3) de la tarjeta y rompería el orden. */}
        <p id={`${id}-title`} className="label">
          {t('video.editorTitle')}
        </p>
        <div className="video-editor-stage">
          {/* Mudo y en línea: es lo que permite el autoplay; el archivo final tampoco tiene audio. */}
          <video
            ref={preview.mainRef}
            src={src}
            muted
            playsInline
            autoPlay={animate}
            preload="auto"
            aria-label={t('video.previewLabel')}
            {...preview.playbackEvents}
          />
          {edit.fade === 'loop' && animate && (
            <video ref={preview.overlayRef} src={src} muted playsInline preload="auto" aria-hidden="true" className="video-editor-overlay" />
          )}
          <div ref={preview.curtainRef} className="video-editor-curtain" aria-hidden="true" />
        </div>
        <div className="video-editor-bar">
          <button type="button" className="ghost" onClick={preview.togglePlay}>
            {preview.playing ? t('video.pause') : t('video.play')}
          </button>
          <p className="help">{animate ? t('video.approximationNote') : t('video.reducedMotionNote')}</p>
        </div>
        <TrimTimeline
          edit={edit}
          durationSeconds={durationSeconds}
          bounds={editor.bounds}
          selectionSeconds={editor.selectionSeconds}
          onStart={editor.setStart}
          onEnd={editor.setEnd}
          playheadRef={preview.playheadRef}
        />
      </div>

      <div className="video-editor-side">
        <FadePicker fade={edit.fade} fadeSeconds={edit.fadeSeconds} onFade={editor.setFade} onFadeSeconds={editor.setFadeSeconds} />
        {reducedMotion && <p className="field-warning">{fadeExplanation(edit, i18n)}</p>}
        {editor.error && (
          <p id={`${id}-error`} className="field-error" role="alert">
            {editor.error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={editor.error !== null}
            aria-describedby={editor.error ? `${id}-error` : undefined}
            onClick={() => onConfirm(edit)}
          >
            {t('video.upload')}
          </button>
        </div>
      </div>
    </section>
  );
}

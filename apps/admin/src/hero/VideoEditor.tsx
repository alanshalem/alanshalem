import { useId } from 'react';
import type { VideoEdit } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion.ts';
import { FadePicker } from './FadePicker.tsx';
import { TrimTimeline } from './TrimTimeline.tsx';
import { useRangePreview } from './useRangePreview.ts';
import { useVideoEditor } from './useVideoEditor.ts';
import { fadeExplanation } from './videoEdit.ts';

interface Props {
  /** Local (blob:) URL of the chosen file: the preview uploads nothing. */
  src: string;
  durationSeconds: number;
  onConfirm: (edit: VideoEdit) => void;
}

/**
 * The step before uploading a video: choosing the segment and the fade on the local file. The server trims and applies
 * the fade when processing; this only chooses the parameters and gives an idea of the result.
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
        {/* A label and not a heading: the editor comes before the card's heading (h3) and would break the order. */}
        <p id={`${id}-title`} className="label">
          {t('video.editorTitle')}
        </p>
        <div className="video-editor-stage">
          {/* Muted and inline: that is what allows autoplay; the final file has no audio either. */}
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

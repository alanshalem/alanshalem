import { useState } from 'react';
import type { FadeSeconds, VideoEdit, VideoFade } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import {
  defaultEdit,
  endingPreviewTime,
  moveTrimEnd,
  moveTrimStart,
  previewLoopStart,
  selectionSeconds,
  trimBounds,
  validateEdit,
} from './videoEdit.ts';

interface EditorState {
  edit: VideoEdit;
  /**
   * Second the preview jumps to after a change, so what was touched shows: the start shows the loop's beginning; the
   * end and the fade, their transition (without this one would wait a whole loop).
   * It is an object so every change jumps again even if the second matches the previous one.
   */
  cue: { seconds: number };
}

/** State of the trim and fade editor of a local video. The rules live in videoEdit.ts. */
export function useVideoEditor(durationSeconds: number) {
  const i18n = useUiLanguage();
  const [{ edit, cue }, setState] = useState((): EditorState => {
    const initial = defaultEdit(durationSeconds);
    return { edit: initial, cue: { seconds: previewLoopStart(initial) } };
  });

  const change = (next: (current: VideoEdit) => VideoEdit, cueOf: (changed: VideoEdit) => number): void =>
    setState((state) => {
      const changed = next(state.edit);
      return { edit: changed, cue: { seconds: cueOf(changed) } };
    });

  return {
    edit,
    cue,
    bounds: trimBounds(durationSeconds),
    selectionSeconds: selectionSeconds(edit),
    error: validateEdit(edit, durationSeconds, i18n),
    setStart: (seconds: number) => change((current) => moveTrimStart(current, seconds, durationSeconds), previewLoopStart),
    setEnd: (seconds: number) => change((current) => moveTrimEnd(current, seconds, durationSeconds), endingPreviewTime),
    setFade: (fade: VideoFade) => change((current) => ({ ...current, fade }), endingPreviewTime),
    setFadeSeconds: (fadeSeconds: FadeSeconds) => change((current) => ({ ...current, fadeSeconds }), endingPreviewTime),
  };
}

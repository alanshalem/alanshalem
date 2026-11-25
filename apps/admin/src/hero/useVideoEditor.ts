import { useState } from 'react';
import type { FadeSeconds, VideoEdit, VideoFade } from '../api/types.ts';
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
   * Segundo al que salta la vista previa después de un cambio, para que se vea lo que se tocó: el inicio muestra
   * el arranque del loop; el fin y el fundido, su transición (sin esto habría que esperar una vuelta entera).
   * Es un objeto para que cada cambio vuelva a saltar aunque el segundo coincida con el anterior.
   */
  cue: { seconds: number };
}

/** Estado del editor de recorte y fundido de un video local (L19). Las reglas viven en videoEdit.ts. */
export function useVideoEditor(durationSeconds: number) {
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
    error: validateEdit(edit, durationSeconds),
    setStart: (seconds: number) => change((current) => moveTrimStart(current, seconds, durationSeconds), previewLoopStart),
    setEnd: (seconds: number) => change((current) => moveTrimEnd(current, seconds, durationSeconds), endingPreviewTime),
    setFade: (fade: VideoFade) => change((current) => ({ ...current, fade }), endingPreviewTime),
    setFadeSeconds: (fadeSeconds: FadeSeconds) => change((current) => ({ ...current, fadeSeconds }), endingPreviewTime),
  };
}

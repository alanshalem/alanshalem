import { useEffect, useRef, useState } from 'react';
import type { VideoEdit } from '../api/types.ts';
import { previewFrame, previewLoopStart, type PreviewFrame } from './videoEdit.ts';

// Margin to consider the segment finished: the last frame may land a bit before the end (one frame at 20 fps).
const END_TOLERANCE_SECONDS = 0.05;
// Tolerated drift between the loop's two videos: more is noticeable; resyncing for less would stutter playback.
const SYNC_TOLERANCE_SECONDS = 0.25;
const STILL: PreviewFrame = { curtainOpacity: 0, overlay: null };

const play = (video: HTMLVideoElement): void => {
  // The browser may refuse to play (background tab, power saving): it stays paused.
  video.play().catch(() => undefined);
};

/**
 * Plays only the chosen segment, looped, and draws the fade approximation on top frame by frame with
 * requestAnimationFrame. It writes styles straight to the elements (opacity, playhead position) instead of going
 * through React state: 60 changes per second that change nothing else on screen.
 * `animate` = false (reduced motion) still honors the segment but does not animate the fade.
 */
export function useRangePreview(edit: VideoEdit, cue: { seconds: number }, durationSeconds: number, animate: boolean) {
  const mainRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (mainRef.current) mainRef.current.currentTime = cue.seconds;
  }, [cue]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const loopStart = previewLoopStart(edit);
    let frame = 0;

    const tick = (): void => {
      const outside = main.currentTime < edit.trimStart || main.currentTime >= edit.trimEnd - END_TOLERANCE_SECONDS;
      if (outside || main.ended) {
        const wasEnded = main.ended;
        main.currentTime = loopStart;
        if (wasEnded) play(main);
      }

      const { curtainOpacity, overlay } = animate ? previewFrame(main.currentTime, edit) : STILL;
      if (curtainRef.current) curtainRef.current.style.opacity = String(curtainOpacity);

      const second = overlayRef.current;
      if (second) {
        second.style.opacity = String(overlay?.opacity ?? 0);
        if (!overlay) {
          if (!second.paused) second.pause();
        } else {
          if (Math.abs(second.currentTime - overlay.time) > SYNC_TOLERANCE_SECONDS) second.currentTime = overlay.time;
          if (main.paused && !second.paused) second.pause();
          if (!main.paused && second.paused) play(second);
        }
      }

      if (playheadRef.current) playheadRef.current.style.left = `${(main.currentTime / durationSeconds) * 100}%`;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    // On segment change, discard or leaving the page: no frame stays scheduled.
    return () => cancelAnimationFrame(frame);
  }, [edit, durationSeconds, animate]);

  const togglePlay = (): void => {
    const main = mainRef.current;
    if (!main) return;
    if (main.paused) play(main);
    else main.pause();
  };

  return {
    mainRef,
    overlayRef,
    curtainRef,
    playheadRef,
    playing,
    togglePlay,
    /** For the main `<video>`: the button reflects the real state (autoplay, system pause). */
    playbackEvents: { onPlay: () => setPlaying(true), onPause: () => setPlaying(false) },
  };
}

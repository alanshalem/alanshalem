import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VideoEdit } from '../api/types.ts';
import { previewFrame, previewLoopStart, type PreviewFrame } from './videoEdit.ts';

// Margen para dar por terminado el tramo: el último cuadro puede caer un poco antes del fin (un cuadro a 20 fps).
const END_TOLERANCE_SECONDS = 0.05;
// Desfase tolerado entre los dos videos del loop: más se nota; resincronizar por menos trabaría la reproducción.
const SYNC_TOLERANCE_SECONDS = 0.25;
const STILL: PreviewFrame = { curtainOpacity: 0, overlay: null };

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const subscribeToMotion = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Si el sistema pide reducir el movimiento (se actualiza si el usuario lo cambia con la página abierta). */
export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(subscribeToMotion, () => window.matchMedia(REDUCED_MOTION).matches);

const play = (video: HTMLVideoElement): void => {
  // El navegador puede negar la reproducción (pestaña en segundo plano, ahorro de energía): queda en pausa.
  video.play().catch(() => undefined);
};

/**
 * Reproduce solo el tramo elegido, en loop, y dibuja encima la aproximación del fundido (L19) cuadro a cuadro con
 * requestAnimationFrame. Escribe estilos directo en los elementos (opacidad, posición del cabezal) en lugar de
 * pasar por el estado de React: son 60 cambios por segundo que no cambian nada más de la pantalla.
 * `animate` = false (reduced motion) sigue respetando el tramo pero no anima el fundido.
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
    // Al cambiar el tramo, al descartar o al salir de la página: no queda ningún cuadro programado.
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
    /** Para el `<video>` principal: el botón refleja el estado real (autoplay, pausa del sistema). */
    playbackEvents: { onPlay: () => setPlaying(true), onPause: () => setPlaying(false) },
  };
}

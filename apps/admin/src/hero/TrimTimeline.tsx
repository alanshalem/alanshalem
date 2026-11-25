import { useId, useRef, useState, type Ref, type RefObject } from 'react';
import type { VideoEdit } from '../api/types.ts';
import { formatSeconds, parseSeconds, sliderKeyValue, trimBounds, VIDEO_DURATION } from './videoEdit.ts';

type TrimBounds = ReturnType<typeof trimBounds>;
type Bounds = TrimBounds['start'];

interface Props {
  edit: VideoEdit;
  durationSeconds: number;
  bounds: TrimBounds;
  selectionSeconds: number;
  onStart: (seconds: number) => void;
  onEnd: (seconds: number) => void;
  /** Línea que marca por dónde va la vista previa; la mueve useRangePreview. */
  playheadRef: Ref<HTMLDivElement>;
}

const percent = (seconds: number, durationSeconds: number): string => `${(seconds / durationSeconds) * 100}%`;

/**
 * Barra con dos manijas sobre la duración del video (S13): se arrastran, se mueven con el teclado (flechas 0,1 s,
 * Shift 1 s) o se escriben en los campos de inicio y fin. Las reglas (topes, la otra manija que acompaña) son de
 * videoEdit.ts; acá solo se traduce puntero, teclado y texto a segundos.
 */
export function TrimTimeline({ edit, durationSeconds, bounds, selectionSeconds, onStart, onEnd, playheadRef }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  return (
    <div className="trim-timeline">
      <div className="trim-track" ref={trackRef}>
        <div
          className="trim-selection"
          style={{ left: percent(edit.trimStart, durationSeconds), width: percent(edit.trimEnd - edit.trimStart, durationSeconds) }}
        />
        <div className="trim-playhead" ref={playheadRef} aria-hidden="true" />
        <TrimHandle
          side="start"
          label="Inicio del tramo"
          value={edit.trimStart}
          bounds={bounds.start}
          durationSeconds={durationSeconds}
          trackRef={trackRef}
          hintId={hintId}
          onChange={onStart}
        />
        <TrimHandle
          side="end"
          label="Fin del tramo"
          value={edit.trimEnd}
          bounds={bounds.end}
          durationSeconds={durationSeconds}
          trackRef={trackRef}
          hintId={hintId}
          onChange={onEnd}
        />
      </div>
      <div className="trim-scale" aria-hidden="true">
        <span>{formatSeconds(0)} s</span>
        <span>{formatSeconds(durationSeconds)} s</span>
      </div>
      <p className="help" id={hintId}>
        Flechas: 0,1 s; con Shift, 1 s. El tramo dura entre {VIDEO_DURATION.minSeconds} y {VIDEO_DURATION.maxSeconds} s:
        si una manija lo pasa, la otra la acompaña.
      </p>
      <div className="trim-fields">
        <SecondsField label="Inicio (s)" value={edit.trimStart} onCommit={onStart} />
        <SecondsField label="Fin (s)" value={edit.trimEnd} onCommit={onEnd} />
        <p className="trim-length" aria-live="polite">
          <span className="label">Tramo</span>
          {formatSeconds(selectionSeconds)} s
        </p>
      </div>
    </div>
  );
}

interface HandleProps {
  side: 'start' | 'end';
  label: string;
  value: number;
  bounds: Bounds;
  durationSeconds: number;
  trackRef: RefObject<HTMLDivElement | null>;
  hintId: string;
  onChange: (seconds: number) => void;
}

/** Una manija: slider de WAI-ARIA con arrastre por puntero (pointer capture: sigue aunque el dedo salga de la barra). */
function TrimHandle({ side, label, value, bounds, durationSeconds, trackRef, hintId, onChange }: HandleProps) {
  const secondsAt = (clientX: number): number => {
    const track = trackRef.current?.getBoundingClientRect();
    // Fuera de la barra da < 0 o > duración: moveTrimStart/End lo acotan.
    return track ? ((clientX - track.left) / track.width) * durationSeconds : value;
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      className={`trim-handle trim-handle-${side}`}
      style={{ left: percent(value, durationSeconds) }}
      aria-label={label}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={value}
      aria-valuetext={`${formatSeconds(value)} s`}
      aria-describedby={hintId}
      onKeyDown={(event) => {
        const next = sliderKeyValue(event.key, event.shiftKey, value);
        if (next === null) return;
        event.preventDefault(); // las flechas no deben desplazar la página
        onChange(next);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(secondsAt(event.clientX));
      }}
    />
  );
}

/**
 * Campo de segundos (alternativa a arrastrar): se edita libre y se aplica al salir o con Enter, así escribir "12"
 * no mueve el tramo a 1 s en el medio. Enter no envía el formulario de la tarjeta (alt y crédito).
 */
function SecondsField({ label, value, onCommit }: { label: string; value: number; onCommit: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    const parsed = draft === null ? null : parseSeconds(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null); // un texto inválido vuelve al valor vigente
  };

  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        inputMode="decimal"
        value={draft ?? formatSeconds(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
    </label>
  );
}

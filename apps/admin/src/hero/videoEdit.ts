import type { FadeSeconds, VideoEdit, VideoFade } from '../api/types.ts';
import type { I18n, MessageKey } from '../i18n/i18n.ts';
import { LIMITS } from '../limits.ts';

/*
 * Pure rules of the trim and fade editor, mirroring the API validation: the segment, the handles' keyboard, the
 * approximate preview and the texts. Everything in seconds of the original file and in tenths, the resolution the
 * user sees and moves. The API stays the authority. Texts and the decimal comma or point come from the received
 * `I18n`.
 */

/** How long the chosen segment can last. */
export const VIDEO_DURATION = { minSeconds: LIMITS.video.minSeconds, maxSeconds: LIMITS.video.maxSeconds } as const;

/** Arrows: one tenth; with Shift (or PageUp/PageDown), one second. */
const TIME_STEP = { fine: 0.1, coarse: 1 } as const;

/** The selector options, in order (the first one is the default). */
export const FADES: readonly VideoFade[] = ['loop', 'black', 'none'];

/** Name and explanation of a fade. The key comes from the type: if the API adds a VideoFade, its text is missing and it does not compile. */
export const fadeText = (fade: VideoFade, i18n: I18n): { label: string; description: string } => ({
  label: i18n.t(`fade.${fade}.label`),
  description: i18n.t(`fade.${fade}.description`),
});

// One name per duration. With a Record over the type, a new duration in LIMITS without its name does not compile.
const FADE_DURATION_LABELS: Record<FadeSeconds, MessageKey> = {
  0.5: 'fade.duration.short',
  1: 'fade.duration.medium',
  2: 'fade.duration.long',
};

/** The duration selector options, in the API's order (short, medium, long). */
export const FADE_DURATIONS: readonly { seconds: FadeSeconds; label: MessageKey }[] = LIMITS.video.fadeSeconds.map((seconds) => ({
  seconds,
  label: FADE_DURATION_LABELS[seconds],
}));

const DEFAULT_FADE = {
  fade: 'loop',
  fadeSeconds: LIMITS.video.defaultFadeSeconds,
} as const satisfies Pick<VideoEdit, 'fade' | 'fadeSeconds'>;

// When the end or the fade moves, the preview jumps to this lead before the transition to show it right away.
const TRANSITION_LEAD_SECONDS = 1;

const toTenths = (seconds: number): number => Math.round(seconds * 10);
// Without ±Infinity (Home/End) or floating point leftovers (0.1 + 0.2): every visible value is an exact tenth.
const roundTenth = (seconds: number): number => (Number.isFinite(seconds) ? toTenths(seconds) / 10 : seconds);
// The default end and the cap never pass the video's real end (7.46 s → 7.4 s); the epsilon absorbs 16.1 × 10.
const floorTenth = (seconds: number): number => Math.floor(seconds * 10 + 1e-6) / 10;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const clamp01 = (value: number): number => clamp(value, 0, 1);

/** Seconds as the handles and fields show them: always one decimal ("2,0" / "2.0"). */
export const formatSeconds = (seconds: number, i18n: I18n): string => i18n.formatNumber(seconds, 1);

/** Fade duration as the options say it ("0,5 s", "1 s"); "s" is the symbol, the same in both languages. */
export const fadeDurationLabel = (seconds: number, i18n: I18n): string => `${i18n.formatNumber(seconds)} s`;

/** Position in the video, m:ss and the tenth only if there is one ("0:02", "0:02,5" / "0:02.5"). */
export function formatClock(seconds: number, i18n: I18n): string {
  const tenths = toTenths(seconds);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  // The language format puts the comma or the point; the leading zero completes the two digits of "ss".
  return `${minutes}:${rest < 100 ? '0' : ''}${i18n.formatNumber(rest / 10)}`;
}

/** What the user types in the start and end fields: accepts a comma or a point. */
export function parseSeconds(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}

/** The only thing trimming cannot fix (size is checked earlier, with the hero rule). */
export function checkVideoDuration(durationSeconds: number, i18n: I18n): string | null {
  return durationSeconds < VIDEO_DURATION.minSeconds
    ? i18n.t('video.tooShort', { seconds: durationSeconds, min: VIDEO_DURATION.minSeconds })
    : null;
}

/** How far each handle goes. Any value inside is reachable because the other handle follows. */
export function trimBounds(durationSeconds: number) {
  const maxEnd = floorTenth(durationSeconds);
  return {
    start: { min: 0, max: roundTenth(maxEnd - VIDEO_DURATION.minSeconds) },
    end: { min: VIDEO_DURATION.minSeconds, max: maxEnd },
  };
}

/** The first min(duration, 15) s with the default fade (a 1 s seamless loop). */
export function defaultEdit(durationSeconds: number): VideoEdit {
  return { trimStart: 0, trimEnd: Math.min(floorTenth(durationSeconds), VIDEO_DURATION.maxSeconds), ...DEFAULT_FADE };
}

/** Moves the start; the end follows so the segment stays between 1 and 15 s and inside the video. */
export function moveTrimStart(edit: VideoEdit, seconds: number, durationSeconds: number): VideoEdit {
  const { start, end } = trimBounds(durationSeconds);
  const trimStart = clamp(roundTenth(seconds), start.min, start.max);
  const trimEnd = clamp(
    edit.trimEnd,
    trimStart + VIDEO_DURATION.minSeconds,
    Math.min(trimStart + VIDEO_DURATION.maxSeconds, end.max),
  );
  return { ...edit, trimStart, trimEnd: roundTenth(trimEnd) };
}

/** Moves the end; the start follows (so the segment can be moved later by moving only the end). */
export function moveTrimEnd(edit: VideoEdit, seconds: number, durationSeconds: number): VideoEdit {
  const { start, end } = trimBounds(durationSeconds);
  const trimEnd = clamp(roundTenth(seconds), end.min, end.max);
  const trimStart = clamp(
    edit.trimStart,
    Math.max(start.min, trimEnd - VIDEO_DURATION.maxSeconds),
    trimEnd - VIDEO_DURATION.minSeconds,
  );
  return { ...edit, trimStart: roundTenth(trimStart), trimEnd };
}

/**
 * The value a key points to on a handle (WAI-ARIA slider pattern), or `null` if the key is not one of its keys.
 * Home/End return ±Infinity: the move clamps it to that handle's limit.
 */
export function sliderKeyValue(key: string, shiftKey: boolean, value: number): number | null {
  const arrow = shiftKey ? TIME_STEP.coarse : TIME_STEP.fine;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return roundTenth(value + arrow);
    case 'ArrowLeft':
    case 'ArrowDown':
      return roundTenth(value - arrow);
    case 'PageUp':
      return roundTenth(value + TIME_STEP.coarse);
    case 'PageDown':
      return roundTenth(value - TIME_STEP.coarse);
    case 'Home':
      return Number.NEGATIVE_INFINITY;
    case 'End':
      return Number.POSITIVE_INFINITY;
    default:
      return null;
  }
}

export const selectionSeconds = ({ trimStart, trimEnd }: VideoEdit): number => roundTenth(trimEnd - trimStart);

/** The same order and limits as the API; `null` = it can be uploaded. */
export function validateEdit(edit: VideoEdit, durationSeconds: number, i18n: I18n): string | null {
  const length = selectionSeconds(edit);
  if (length < VIDEO_DURATION.minSeconds) {
    return i18n.t('video.trimTooShort', { seconds: length, min: VIDEO_DURATION.minSeconds });
  }
  if (length > VIDEO_DURATION.maxSeconds) {
    return i18n.t('video.trimTooLong', { seconds: length, max: VIDEO_DURATION.maxSeconds });
  }
  if (edit.trimStart < 0 || edit.trimEnd > durationSeconds) {
    return i18n.t('video.trimOutside', { duration: durationSeconds });
  }
  if (edit.fade !== 'none' && edit.fadeSeconds * 2 > length) {
    // Explains why it needs twice as long, per kind (the user chooses and has to understand it).
    return i18n.t(`video.fadeTooLong.${edit.fade}`, {
      fade: fadeDurationLabel(edit.fadeSeconds, i18n),
      needed: fadeDurationLabel(edit.fadeSeconds * 2, i18n),
      length,
    });
  }
  return null;
}

/** The chip of a processed video: "0:02–0:15 · Loop perfecto 1 s". */
export function editSummary(edit: VideoEdit, i18n: I18n): string {
  const { label } = fadeText(edit.fade, i18n);
  const fade = edit.fade === 'none' ? label : `${label} ${fadeDurationLabel(edit.fadeSeconds, i18n)}`;
  return `${formatClock(edit.trimStart, i18n)}–${formatClock(edit.trimEnd, i18n)} · ${fade}`;
}

/** What is shown instead of animating the fade when the system asks to reduce motion. */
export function fadeExplanation(edit: VideoEdit, i18n: I18n): string {
  const { label, description } = fadeText(edit.fade, i18n);
  const title = edit.fade === 'none' ? label : `${label} (${fadeDurationLabel(edit.fadeSeconds, i18n)})`;
  return `${title}. ${description}`;
}

/*
 * Approximate preview in the browser. ffmpeg builds the real result; this only gives an idea:
 * - black: a black layer on top whose opacity goes from 1 to 0 at the start and from 0 to 1 at the end.
 * - loop: a second <video> on top that starts at the segment's start during the last `fadeSeconds` and fades in; at
 *   the end, the main one jumps to where the second one got to (start + fadeSeconds), like the server's output,
 *   which lasts segment − fadeSeconds.
 * - none: nothing on top; the main one goes back to the start.
 */

export interface PreviewFrame {
  curtainOpacity: number;
  /** The loop's second video: where it must be and how visible it is; `null` = hidden. */
  overlay: { opacity: number; time: number } | null;
}

/** What shows on top of the main video when it is at second `time`. */
export function previewFrame(time: number, edit: VideoEdit): PreviewFrame {
  const { trimStart, trimEnd, fadeSeconds } = edit;
  if (edit.fade === 'black') {
    const nearestEdge = Math.min(time - trimStart, trimEnd - time);
    return { curtainOpacity: clamp01(1 - nearestEdge / fadeSeconds), overlay: null };
  }
  if (edit.fade === 'loop') {
    const fadeFrom = trimEnd - fadeSeconds;
    if (time < fadeFrom) return { curtainOpacity: 0, overlay: null };
    const elapsed = Math.min(time - fadeFrom, fadeSeconds);
    return { curtainOpacity: 0, overlay: { opacity: clamp01(elapsed / fadeSeconds), time: trimStart + elapsed } };
  }
  return { curtainOpacity: 0, overlay: null };
}

/** Where the main video returns to when it reaches the end of the segment. */
export const previewLoopStart = (edit: VideoEdit): number =>
  edit.fade === 'loop' ? roundTenth(edit.trimStart + edit.fadeSeconds) : edit.trimStart;

/** Where to jump when the end or the fade changes: one second before the transition, without leaving the loop. */
export function endingPreviewTime(edit: VideoEdit): number {
  const transition = edit.fade === 'none' ? edit.trimEnd : edit.trimEnd - edit.fadeSeconds;
  return Math.max(previewLoopStart(edit), roundTenth(transition - TRANSITION_LEAD_SECONDS));
}

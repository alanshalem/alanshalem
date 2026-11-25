import { useId } from 'react';
import type { FadeSeconds, VideoFade } from '../api/types.ts';
import { FADE_DURATIONS, fadeDurationLabel, FADES } from './videoEdit.ts';

interface Props {
  fade: VideoFade;
  fadeSeconds: FadeSeconds;
  onFade: (fade: VideoFade) => void;
  onFadeSeconds: (seconds: FadeSeconds) => void;
}

/** Tipo de fundido (S14) con su explicación y duración (S15). Sin fundido, la duración no aplica y se deshabilita. */
export function FadePicker({ fade, fadeSeconds, onFade, onFadeSeconds }: Props) {
  const name = useId();

  return (
    <div className="fade-picker">
      <fieldset className="fade-group">
        <legend className="label">Fundido</legend>
        {FADES.map((option) => (
          <label key={option.value} className="fade-option">
            <input type="radio" name={`${name}-fade`} checked={fade === option.value} onChange={() => onFade(option.value)} />
            <span>
              <span className="fade-option-label">{option.label}</span>
              <span className="help">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="fade-group" disabled={fade === 'none'}>
        <legend className="label">Duración del fundido</legend>
        <div className="fade-durations">
          {FADE_DURATIONS.map((option) => (
            <label key={option.seconds} className="fade-duration">
              <input
                type="radio"
                name={`${name}-seconds`}
                checked={fadeSeconds === option.seconds}
                onChange={() => onFadeSeconds(option.seconds)}
              />
              {option.label} {fadeDurationLabel(option.seconds)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

import { useId } from 'react';
import type { FadeSeconds, VideoFade } from '../api/types.ts';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { FADE_DURATIONS, fadeDurationLabel, FADES, fadeText } from './videoEdit.ts';

interface Props {
  fade: VideoFade;
  fadeSeconds: FadeSeconds;
  onFade: (fade: VideoFade) => void;
  onFadeSeconds: (seconds: FadeSeconds) => void;
}

/** Fade kind with its explanation and duration. Without a fade, the duration does not apply and is disabled. */
export function FadePicker({ fade, fadeSeconds, onFade, onFadeSeconds }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const name = useId();

  return (
    <div className="fade-picker">
      <fieldset className="fade-group">
        <legend className="label">{t('fade.legend')}</legend>
        {FADES.map((value) => {
          const { label, description } = fadeText(value, i18n);
          return (
            <label key={value} className="fade-option">
              <input type="radio" name={`${name}-fade`} checked={fade === value} onChange={() => onFade(value)} />
              <span>
                <span className="fade-option-label">{label}</span>
                <span className="help">{description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="fade-group" disabled={fade === 'none'}>
        <legend className="label">{t('fade.durationLegend')}</legend>
        <div className="fade-durations">
          {FADE_DURATIONS.map((option) => (
            <label key={option.seconds} className="fade-duration">
              <input
                type="radio"
                name={`${name}-seconds`}
                checked={fadeSeconds === option.seconds}
                onChange={() => onFadeSeconds(option.seconds)}
              />
              {t(option.label)} {fadeDurationLabel(option.seconds, i18n)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

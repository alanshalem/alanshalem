import { useId, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/problem.ts';
import type { Post } from '../api/types.ts';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import {
  browserTimeZone,
  checkSchedule,
  formatUtcOffset,
  scheduledAt,
  scheduledLabel,
  toLocalDateTime,
  type LocalDateTime,
} from './schedule.ts';

interface Props {
  /** A draft: a published post is not scheduled. */
  post: Post;
  busy: boolean;
  /** Schedules (saving pending changes first); null if it could not start. An API error is thrown. */
  onSchedule: (publishAt: string) => Promise<Post | null>;
  onUnschedule: () => Promise<Post | null>;
  onError: (error: unknown) => boolean;
}

const EMPTY: LocalDateTime = { date: '', time: '' };

/** Scheduled publishing: date and time in the browser's zone; the server publishes and rebuilds the site. */
export function SchedulePanel({ post, busy, onSchedule, onUnschedule, onError }: Props) {
  const id = useId();
  const i18n = useUiLanguage();
  const { t, formatDateTime } = i18n;
  const at = scheduledAt(post);
  const [local, setLocal] = useState<LocalDateTime>(() => (at ? toLocalDateTime(at, browserTimeZone) : EMPTY));
  // `invalid`: a field error (the API's is not about a particular field).
  const [error, setError] = useState<{ text: string; invalid: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const check = checkSchedule(local, now, browserTimeZone);
  // The offset of the chosen date (with daylight saving time it may differ from today's).
  const offset = browserTimeZone.offsetMinutes(check.ok ? new Date(check.publishAt) : now);
  const today = toLocalDateTime(now.toISOString(), browserTimeZone).date;
  const errorId = `${id}-error`;
  const describedBy = error ? `${id}-zone ${errorId}` : `${id}-zone`;

  /** Runs the action and announces the result; the API message is shown as is (it comes translated). */
  const run = async (action: () => Promise<Post | null>, success: (result: Post) => string): Promise<Post | null> => {
    setStatus('');
    setError(null);
    try {
      const result = await action();
      if (result) setStatus(success(result));
      return result;
    } catch (caught) {
      if (!onError(caught)) setError({ text: errorMessage(caught, t('schedule.error')), invalid: false });
      return null;
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const result = checkSchedule(local, new Date(), browserTimeZone);
    if (!result.ok) {
      setStatus('');
      setError({ text: t(`schedule.${result.error}`), invalid: true });
      // Focus to the field to fix: the empty one or, if the date already passed, the date.
      (result.error === 'required' && local.date !== '' ? timeRef : dateRef).current?.focus();
      return;
    }
    void run(
      () => onSchedule(result.publishAt),
      (saved) => t('schedule.done', { date: saved.scheduledAt ? formatDateTime(saved.scheduledAt) : '' }),
    );
  };

  const cancel = async (): Promise<void> => {
    // "Cancelar" goes away: focus is not lost, it goes to the date.
    if (await run(onUnschedule, () => t('schedule.canceled'))) dateRef.current?.focus();
  };

  const update = (change: Partial<LocalDateTime>): void => {
    setError(null);
    setLocal((current) => ({ ...current, ...change }));
  };

  return (
    <ToolPanel
      title={t('schedule.title')}
      defaultOpen={at !== null}
      badge={at && <span className="chip chip-scheduled">{scheduledLabel(at, i18n)}</span>}
    >
      <form className="schedule" noValidate onSubmit={submit}>
        {at && (
          <p className="schedule-at">
            <span>{t('schedule.at', { date: formatDateTime(at) })}</span>
            <button type="button" disabled={busy} onClick={() => void cancel()}>
              {t('schedule.cancel')}
            </button>
          </p>
        )}
        <div className="schedule-fields">
          <label className="field">
            <span className="label">{t('schedule.date')}</span>
            <input
              ref={dateRef}
              type="date"
              required
              min={today}
              value={local.date}
              onChange={(event) => update({ date: event.target.value })}
              aria-invalid={error?.invalid || undefined}
              aria-describedby={describedBy}
            />
          </label>
          <label className="field">
            <span className="label">{t('schedule.time')}</span>
            <input
              ref={timeRef}
              type="time"
              required
              value={local.time}
              onChange={(event) => update({ time: event.target.value })}
              aria-invalid={error?.invalid || undefined}
              aria-describedby={describedBy}
            />
          </label>
          <button type="submit" disabled={busy}>
            {at ? t('schedule.change') : t('schedule.submit')}
          </button>
        </div>
        <p id={`${id}-zone`} className="help">
          {t('schedule.zone', { zone: browserTimeZone.name, offset: formatUtcOffset(offset) })}
        </p>
        {error && (
          <p id={errorId} className="field-error" role="alert">
            {error.text}
          </p>
        )}
        <p className="field-status" role="status">
          {status}
        </p>
      </form>
    </ToolPanel>
  );
}

import { useId, useRef, useState, type FormEvent } from 'react';
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
  /** Un borrador: un post publicado no se programa. */
  post: Post;
  busy: boolean;
  /** Programa (guardando antes lo pendiente); null si no se pudo empezar. Un error de la API se lanza. */
  onSchedule: (publishAt: string) => Promise<Post | null>;
  onUnschedule: () => Promise<Post | null>;
  onError: (error: unknown) => boolean;
}

const EMPTY: LocalDateTime = { date: '', time: '' };

/** Publicación programada (S5): fecha y hora en la zona del navegador; el servidor publica y regenera el sitio. */
export function SchedulePanel({ post, busy, onSchedule, onUnschedule, onError }: Props) {
  const id = useId();
  const i18n = useUiLanguage();
  const { t, formatDateTime } = i18n;
  const at = scheduledAt(post);
  const [local, setLocal] = useState<LocalDateTime>(() => (at ? toLocalDateTime(at, browserTimeZone) : EMPTY));
  // `invalid`: un error de los campos (lo de la API no es de un campo en particular).
  const [error, setError] = useState<{ text: string; invalid: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const check = checkSchedule(local, now, browserTimeZone);
  // El desplazamiento de la fecha elegida (con horario de verano puede no ser el de hoy).
  const offset = browserTimeZone.offsetMinutes(check.ok ? new Date(check.publishAt) : now);
  const today = toLocalDateTime(now.toISOString(), browserTimeZone).date;
  const errorId = `${id}-error`;
  const describedBy = error ? `${id}-zone ${errorId}` : `${id}-zone`;

  /** Corre la acción y anuncia el resultado; el mensaje de la API se muestra tal cual (ya viene traducido). */
  const run = async (action: () => Promise<Post | null>, success: (result: Post) => string): Promise<Post | null> => {
    setStatus('');
    setError(null);
    try {
      const result = await action();
      if (result) setStatus(success(result));
      return result;
    } catch (caught) {
      if (!onError(caught)) setError({ text: caught instanceof Error ? caught.message : t('schedule.error'), invalid: false });
      return null;
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const result = checkSchedule(local, new Date(), browserTimeZone);
    if (!result.ok) {
      setStatus('');
      setError({ text: t(`schedule.${result.error}`), invalid: true });
      // El foco al campo que hay que corregir: el vacío o, si la fecha ya pasó, la fecha.
      (result.error === 'required' && local.date !== '' ? timeRef : dateRef).current?.focus();
      return;
    }
    void run(
      () => onSchedule(result.publishAt),
      (saved) => t('schedule.done', { date: saved.scheduledAt ? formatDateTime(saved.scheduledAt) : '' }),
    );
  };

  const cancel = async (): Promise<void> => {
    // "Cancelar" desaparece: el foco no se pierde, va a la fecha.
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

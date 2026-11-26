import type { PostSummary } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';

/*
 * Publicación programada (S5, L4): la fecha y la hora se eligen en la zona del navegador y viajan como ISO 8601 con
 * el desplazamiento de ese instante ("2026-12-01T09:00:00-03:00"): la API exige la zona porque sin ella la hora es
 * ambigua (¿la del admin o la del servidor?). La zona es un parámetro (Strategy) para que los tests no dependan de la
 * zona de la máquina.
 */

/** Lo que dan `<input type="date">` y `<input type="time">`: "YYYY-MM-DD" y "HH:mm" ("" si están incompletos). */
export interface LocalDateTime {
  readonly date: string;
  readonly time: string;
}

export interface TimeZone {
  /** Nombre IANA ("America/Argentina/Buenos_Aires"): se muestra junto a los campos. */
  readonly name: string;
  /** El instante de una fecha y hora de reloj en esta zona. */
  toInstant(local: LocalDateTime): Date;
  /** Minutos al este de UTC en ese instante (cambia con el horario de verano). */
  offsetMinutes(instant: Date): number;
}

const MINUTE_MS = 60_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * La zona del navegador. `new Date(año, mes, …)` interpreta la hora en esa zona y, si no existe (el salto del horario
 * de verano), la corre hacia adelante: el ISO resultante lleva la hora corrida, que sí existe.
 */
export const browserTimeZone: TimeZone = {
  name: Intl.DateTimeFormat().resolvedOptions().timeZone,
  toInstant: ({ date, time }) => {
    const [, year, month, day] = DATE_PATTERN.exec(date)!.map(Number);
    const [, hours, minutes] = TIME_PATTERN.exec(time)!.map(Number);
    return new Date(year!, month! - 1, day!, hours!, minutes!);
  },
  offsetMinutes: (instant) => -instant.getTimezoneOffset(),
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** "+05:45" / "-03:00": el formato del desplazamiento en ISO 8601. */
const isoOffset = (minutes: number): string =>
  `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

/** "UTC−03:00": con el signo menos tipográfico, que los lectores de pantalla leen como "menos" y no como guion. */
export const formatUtcOffset = (minutes: number): string => `UTC${isoOffset(minutes).replace('-', '−')}`;

/** El reloj de la zona en ese instante, como fecha UTC (sus getters UTC dan la hora de pared). */
const wallClock = (instant: Date, zone: TimeZone): Date => new Date(instant.getTime() + zone.offsetMinutes(instant) * MINUTE_MS);

/** El instante como hora local de la zona + su desplazamiento: "2026-12-01T09:00:00-03:00". */
export function toIsoWithOffset(instant: Date, zone: TimeZone): string {
  const wall = wallClock(instant, zone);
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  return `${date}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00${isoOffset(zone.offsetMinutes(instant))}`;
}

/** Una fecha de la API (UTC) en los campos fecha y hora de la zona. */
export function toLocalDateTime(iso: string, zone: TimeZone): LocalDateTime {
  const [date = '', time = ''] = toIsoWithOffset(new Date(iso), zone).split('T');
  return { date, time: time.slice(0, 5) };
}

/** Los mismos motivos que la API (`post.publishAtRequired`, `post.scheduleInPast`), con el texto del admin. */
export type ScheduleError = 'required' | 'past';

export type ScheduleCheck = { readonly ok: true; readonly publishAt: string } | { readonly ok: false; readonly error: ScheduleError };

/** Valida como la API (fecha y hora completas, en el futuro) y arma el `publishAt` de `PUT /schedule`. */
export function checkSchedule(local: LocalDateTime, now: Date, zone: TimeZone): ScheduleCheck {
  if (!DATE_PATTERN.test(local.date) || !TIME_PATTERN.test(local.time)) return { ok: false, error: 'required' };
  const instant = zone.toInstant(local);
  if (instant <= now) return { ok: false, error: 'past' };
  return { ok: true, publishAt: toIsoWithOffset(instant, zone) };
}

/** La fecha en que se publica solo, o null. Un post publicado ya no está programado (publicar borra la fecha). */
export const scheduledAt = (post: Pick<PostSummary, 'status' | 'scheduledAt'>): string | null =>
  post.status === 'draft' ? post.scheduledAt : null;

/** El chip de la lista y del panel: "Programado · 1 dic 2026, 09:00". */
export const scheduledLabel = (iso: string, { t, formatDateTime }: I18n): string =>
  t('schedule.chip', { date: formatDateTime(iso) });

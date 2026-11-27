import type { PostSummary } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';

/*
 * Scheduled publishing: the date and time are chosen in the browser's zone and travel as ISO 8601 with that instant's
 * offset ("2026-12-01T09:00:00-03:00"): the API requires the zone because without it the time is ambiguous (the
 * admin's or the server's?). The zone is a parameter (Strategy) so the tests do not depend on the machine's zone.
 */

/** What `<input type="date">` and `<input type="time">` give: "YYYY-MM-DD" and "HH:mm" ("" if incomplete). */
export interface LocalDateTime {
  readonly date: string;
  readonly time: string;
}

export interface TimeZone {
  /** IANA name ("America/Argentina/Buenos_Aires"): shown next to the fields. */
  readonly name: string;
  /** The instant of a wall-clock date and time in this zone. */
  toInstant(local: LocalDateTime): Date;
  /** Minutes east of UTC at that instant (it changes with daylight saving time). */
  offsetMinutes(instant: Date): number;
}

const MINUTE_MS = 60_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * The browser's zone. `new Date(year, month, …)` reads the time in that zone and, if it does not exist (the daylight
 * saving jump), moves it forward: the resulting ISO carries the shifted time, which does exist.
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

/** "+05:45" / "-03:00": the ISO 8601 offset format. */
const isoOffset = (minutes: number): string =>
  `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

/** "UTC−03:00": with the typographic minus sign, which screen readers read as "minus" and not as a hyphen. */
export const formatUtcOffset = (minutes: number): string => `UTC${isoOffset(minutes).replace('-', '−')}`;

/** The zone's clock at that instant, as a UTC date (its UTC getters give the wall time). */
const wallClock = (instant: Date, zone: TimeZone): Date => new Date(instant.getTime() + zone.offsetMinutes(instant) * MINUTE_MS);

/** The instant as the zone's local time + its offset: "2026-12-01T09:00:00-03:00". */
export function toIsoWithOffset(instant: Date, zone: TimeZone): string {
  const wall = wallClock(instant, zone);
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  return `${date}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00${isoOffset(zone.offsetMinutes(instant))}`;
}

/** An API date (UTC) in the zone's date and time fields. */
export function toLocalDateTime(iso: string, zone: TimeZone): LocalDateTime {
  const [date = '', time = ''] = toIsoWithOffset(new Date(iso), zone).split('T');
  return { date, time: time.slice(0, 5) };
}

/** The same reasons as the API (`post.publishAtRequired`, `post.scheduleInPast`), with the admin's text. */
export type ScheduleError = 'required' | 'past';

export type ScheduleCheck = { readonly ok: true; readonly publishAt: string } | { readonly ok: false; readonly error: ScheduleError };

/** Validates like the API (full date and time, in the future) and builds the `publishAt` of `PUT /schedule`. */
export function checkSchedule(local: LocalDateTime, now: Date, zone: TimeZone): ScheduleCheck {
  if (!DATE_PATTERN.test(local.date) || !TIME_PATTERN.test(local.time)) return { ok: false, error: 'required' };
  const instant = zone.toInstant(local);
  if (instant <= now) return { ok: false, error: 'past' };
  return { ok: true, publishAt: toIsoWithOffset(instant, zone) };
}

/** The date it publishes on its own, or null. A published post is no longer scheduled (publishing clears the date). */
export const scheduledAt = (post: Pick<PostSummary, 'status' | 'scheduledAt'>): string | null =>
  post.status === 'draft' ? post.scheduledAt : null;

/** The chip of the list and the panel: "Programado · 1 dic 2026, 09:00". */
export const scheduledLabel = (iso: string, { t, formatDateTime }: I18n): string =>
  t('schedule.chip', { date: formatDateTime(iso) });

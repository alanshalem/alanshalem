import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostSummary } from '../src/api/types.ts';
import { i18nFor } from '../src/i18n/i18n.ts';
import {
  browserTimeZone,
  checkSchedule,
  formatUtcOffset,
  scheduledAt,
  scheduledLabel,
  toIsoWithOffset,
  toLocalDateTime,
  type LocalDateTime,
  type TimeZone,
} from '../src/posts/schedule.ts';

/*
 * Scheduled publishing: the date and time are chosen in the browser's zone and travel as ISO 8601 with their offset
 * (the API requires the zone: without it the time is ambiguous). Fake zones make the tests independent of the
 * machine's zone.
 */

const MINUTE = 60_000;

/** A zone without daylight saving time: always the same offset. */
const fixedZone = (offset: number): TimeZone => ({
  name: `Fixed/${offset}`,
  toInstant: ({ date, time }) => new Date(Date.parse(`${date}T${time}:00Z`) - offset * MINUTE),
  offsetMinutes: () => offset,
});

/** A zone with daylight saving time: −03:00 until `change` and −02:00 from then on (like a spring jump). */
const dstZone = (change: Date): TimeZone => {
  const offsetMinutes = (instant: Date): number => (instant < change ? -180 : -120);
  return {
    name: 'Test/DST',
    toInstant: ({ date, time }) => {
      const wall = Date.parse(`${date}T${time}:00Z`);
      const withOld = new Date(wall + 180 * MINUTE);
      const withNew = new Date(wall + 120 * MINUTE);
      if (withOld < change) return withOld;
      // The wall time that does not exist (the jump) keeps the previous offset: Date moves it forward.
      return withNew >= change ? withNew : withOld;
    },
    offsetMinutes,
  };
};

const local = (date: string, time: string): LocalDateTime => ({ date, time });

describe('formatUtcOffset: the readable zone offset', () => {
  it('sign, two-digit hours and minutes (typographic minus sign)', () => {
    assert.equal(formatUtcOffset(-180), 'UTC−03:00');
    assert.equal(formatUtcOffset(0), 'UTC+00:00');
    assert.equal(formatUtcOffset(345), 'UTC+05:45');
    assert.equal(formatUtcOffset(-570), 'UTC−09:30');
    assert.equal(formatUtcOffset(840), 'UTC+14:00');
  });
});

describe('toIsoWithOffset: the instant as local time + offset', () => {
  it('Buenos Aires (−03:00): the same wall time that was chosen', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-01T12:00:00Z'), fixedZone(-180)), '2026-12-01T09:00:00-03:00');
  });

  it('UTC: explicit +00:00 (not Z)', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-01T09:00:00Z'), fixedZone(0)), '2026-12-01T09:00:00+00:00');
  });

  it('offsets with minutes and a day or year change', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-31T20:00:00Z'), fixedZone(345)), '2027-01-01T01:45:00+05:45');
    assert.equal(toIsoWithOffset(new Date('2026-01-01T05:00:00Z'), fixedZone(-570)), '2025-12-31T19:30:00-09:30');
    assert.equal(toIsoWithOffset(new Date('2026-06-30T11:00:00Z'), fixedZone(840)), '2026-07-01T01:00:00+14:00');
  });

  it('with daylight saving time it uses that instant offset, not today one', () => {
    const zone = dstZone(new Date('2026-10-04T03:00:00Z'));
    assert.equal(toIsoWithOffset(new Date('2026-10-03T12:00:00Z'), zone), '2026-10-03T09:00:00-03:00');
    assert.equal(toIsoWithOffset(new Date('2026-10-05T12:00:00Z'), zone), '2026-10-05T10:00:00-02:00');
  });
});

describe('toLocalDateTime: the schedule back in the date and time fields', () => {
  it('the wall time in the zone, even though the API returns UTC', () => {
    assert.deepEqual(toLocalDateTime('2026-12-01T12:00:00Z', fixedZone(-180)), local('2026-12-01', '09:00'));
    assert.deepEqual(toLocalDateTime('2026-12-31T20:00:00Z', fixedZone(345)), local('2027-01-01', '01:45'));
  });

  it('round trip in the browser zone (the one of the machine running the test)', () => {
    const chosen = local('2027-03-15', '18:30');
    const check = checkSchedule(chosen, new Date('2026-01-01T00:00:00Z'), browserTimeZone);
    assert.ok(check.ok);
    assert.deepEqual(toLocalDateTime(check.publishAt, browserTimeZone), chosen);
    assert.equal(Date.parse(check.publishAt), new Date(2027, 2, 15, 18, 30).getTime());
    assert.match(check.publishAt, /^2027-03-15T18:30:00[+-]\d\d:\d\d$/);
  });
});

describe('checkSchedule: the same the API validates (future, with date and time)', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const zone = fixedZone(-180);

  it('future: the ISO with offset that PUT /schedule expects', () => {
    assert.deepEqual(checkSchedule(local('2026-11-26', '09:01'), now, zone), {
      ok: true,
      publishAt: '2026-11-26T09:01:00-03:00',
    });
  });

  it('now or earlier: in the past', () => {
    assert.deepEqual(checkSchedule(local('2026-11-26', '09:00'), now, zone), { ok: false, error: 'past' });
    assert.deepEqual(checkSchedule(local('2025-12-31', '23:59'), now, zone), { ok: false, error: 'past' });
  });

  it('without date or time (the native fields give "" when incomplete)', () => {
    assert.deepEqual(checkSchedule(local('', '09:00'), now, zone), { ok: false, error: 'required' });
    assert.deepEqual(checkSchedule(local('2026-12-01', ''), now, zone), { ok: false, error: 'required' });
    assert.deepEqual(checkSchedule(local('tomorrow', '9'), now, zone), { ok: false, error: 'required' });
  });

  it('a time that does not exist because of the daylight saving jump moves forward and is still valid', () => {
    const zoneWithDst = dstZone(new Date('2026-10-04T03:00:00Z'));
    assert.deepEqual(checkSchedule(local('2026-10-04', '00:30'), new Date('2026-10-01T00:00:00Z'), zoneWithDst), {
      ok: true,
      publishAt: '2026-10-04T01:30:00-02:00',
    });
  });
});

describe('scheduledAt and scheduledLabel: the list "Programado · date" chip', () => {
  const post = (overrides: Partial<PostSummary>): Pick<PostSummary, 'status' | 'scheduledAt'> => ({
    status: 'draft',
    scheduledAt: null,
    ...overrides,
  });

  it('only drafts with a date (a published post is no longer scheduled)', () => {
    assert.equal(scheduledAt(post({ scheduledAt: '2026-12-01T12:00:00Z' })), '2026-12-01T12:00:00Z');
    assert.equal(scheduledAt(post({})), null);
    assert.equal(scheduledAt(post({ status: 'published', scheduledAt: '2026-12-01T12:00:00Z' })), null);
  });

  it('date and time in the UI language', () => {
    const iso = new Date(2026, 11, 1, 9, 5).toISOString();
    assert.equal(scheduledLabel(iso, i18nFor('es')), 'Programado · 1 dic 2026, 09:05');
    assert.equal(scheduledLabel(iso, i18nFor('en')), 'Scheduled · Dec 1, 2026, 9:05 AM');
  });
});

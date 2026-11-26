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
 * Publicación programada (S5, E5): la fecha y hora se eligen en la zona del navegador y viajan como ISO 8601 con su
 * desplazamiento (la API exige la zona: sin ella la hora es ambigua). Las zonas falsas hacen los tests independientes
 * de la zona de la máquina.
 */

const MINUTE = 60_000;

/** Una zona sin horario de verano: siempre el mismo desplazamiento. */
const fixedZone = (offset: number): TimeZone => ({
  name: `Fixed/${offset}`,
  toInstant: ({ date, time }) => new Date(Date.parse(`${date}T${time}:00Z`) - offset * MINUTE),
  offsetMinutes: () => offset,
});

/** Una zona con horario de verano: −03:00 hasta `change` y −02:00 desde ahí (como un salto de primavera). */
const dstZone = (change: Date): TimeZone => {
  const offsetMinutes = (instant: Date): number => (instant < change ? -180 : -120);
  return {
    name: 'Test/DST',
    toInstant: ({ date, time }) => {
      const wall = Date.parse(`${date}T${time}:00Z`);
      const withOld = new Date(wall + 180 * MINUTE);
      const withNew = new Date(wall + 120 * MINUTE);
      if (withOld < change) return withOld;
      // La hora de pared que no existe (el salto) queda con el desplazamiento de antes: Date la corre hacia adelante.
      return withNew >= change ? withNew : withOld;
    },
    offsetMinutes,
  };
};

const local = (date: string, time: string): LocalDateTime => ({ date, time });

describe('formatUtcOffset: el desplazamiento legible de la zona', () => {
  it('signo, horas y minutos con dos cifras (signo menos tipográfico)', () => {
    assert.equal(formatUtcOffset(-180), 'UTC−03:00');
    assert.equal(formatUtcOffset(0), 'UTC+00:00');
    assert.equal(formatUtcOffset(345), 'UTC+05:45');
    assert.equal(formatUtcOffset(-570), 'UTC−09:30');
    assert.equal(formatUtcOffset(840), 'UTC+14:00');
  });
});

describe('toIsoWithOffset: el instante como hora local + desplazamiento', () => {
  it('Buenos Aires (−03:00): la misma hora de pared que se eligió', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-01T12:00:00Z'), fixedZone(-180)), '2026-12-01T09:00:00-03:00');
  });

  it('UTC: +00:00 explícito (no Z)', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-01T09:00:00Z'), fixedZone(0)), '2026-12-01T09:00:00+00:00');
  });

  it('desplazamientos con minutos y cambio de día o de año', () => {
    assert.equal(toIsoWithOffset(new Date('2026-12-31T20:00:00Z'), fixedZone(345)), '2027-01-01T01:45:00+05:45');
    assert.equal(toIsoWithOffset(new Date('2026-01-01T05:00:00Z'), fixedZone(-570)), '2025-12-31T19:30:00-09:30');
    assert.equal(toIsoWithOffset(new Date('2026-06-30T11:00:00Z'), fixedZone(840)), '2026-07-01T01:00:00+14:00');
  });

  it('con horario de verano usa el desplazamiento de ese instante, no el de hoy', () => {
    const zone = dstZone(new Date('2026-10-04T03:00:00Z'));
    assert.equal(toIsoWithOffset(new Date('2026-10-03T12:00:00Z'), zone), '2026-10-03T09:00:00-03:00');
    assert.equal(toIsoWithOffset(new Date('2026-10-05T12:00:00Z'), zone), '2026-10-05T10:00:00-02:00');
  });
});

describe('toLocalDateTime: lo programado de vuelta en los campos fecha y hora', () => {
  it('la hora de pared en la zona, aunque la API la devuelva en UTC', () => {
    assert.deepEqual(toLocalDateTime('2026-12-01T12:00:00Z', fixedZone(-180)), local('2026-12-01', '09:00'));
    assert.deepEqual(toLocalDateTime('2026-12-31T20:00:00Z', fixedZone(345)), local('2027-01-01', '01:45'));
  });

  it('ida y vuelta en la zona del navegador (la de la máquina que corre el test)', () => {
    const chosen = local('2027-03-15', '18:30');
    const check = checkSchedule(chosen, new Date('2026-01-01T00:00:00Z'), browserTimeZone);
    assert.ok(check.ok);
    assert.deepEqual(toLocalDateTime(check.publishAt, browserTimeZone), chosen);
    assert.equal(Date.parse(check.publishAt), new Date(2027, 2, 15, 18, 30).getTime());
    assert.match(check.publishAt, /^2027-03-15T18:30:00[+-]\d\d:\d\d$/);
  });
});

describe('checkSchedule: lo mismo que valida la API (futuro y con fecha y hora)', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const zone = fixedZone(-180);

  it('futuro: el ISO con desplazamiento que espera PUT /schedule', () => {
    assert.deepEqual(checkSchedule(local('2026-11-26', '09:01'), now, zone), {
      ok: true,
      publishAt: '2026-11-26T09:01:00-03:00',
    });
  });

  it('ahora o antes: en el pasado', () => {
    assert.deepEqual(checkSchedule(local('2026-11-26', '09:00'), now, zone), { ok: false, error: 'past' });
    assert.deepEqual(checkSchedule(local('2025-12-31', '23:59'), now, zone), { ok: false, error: 'past' });
  });

  it('sin fecha o sin hora (los campos nativos dan "" si están incompletos)', () => {
    assert.deepEqual(checkSchedule(local('', '09:00'), now, zone), { ok: false, error: 'required' });
    assert.deepEqual(checkSchedule(local('2026-12-01', ''), now, zone), { ok: false, error: 'required' });
    assert.deepEqual(checkSchedule(local('mañana', '9'), now, zone), { ok: false, error: 'required' });
  });

  it('una hora que no existe por el salto de horario se corre hacia adelante y sigue siendo válida', () => {
    const zoneWithDst = dstZone(new Date('2026-10-04T03:00:00Z'));
    assert.deepEqual(checkSchedule(local('2026-10-04', '00:30'), new Date('2026-10-01T00:00:00Z'), zoneWithDst), {
      ok: true,
      publishAt: '2026-10-04T01:30:00-02:00',
    });
  });
});

describe('scheduledAt y scheduledLabel: el chip "Programado · fecha" de la lista', () => {
  const post = (overrides: Partial<PostSummary>): Pick<PostSummary, 'status' | 'scheduledAt'> => ({
    status: 'draft',
    scheduledAt: null,
    ...overrides,
  });

  it('solo los borradores con fecha (un post publicado ya no está programado)', () => {
    assert.equal(scheduledAt(post({ scheduledAt: '2026-12-01T12:00:00Z' })), '2026-12-01T12:00:00Z');
    assert.equal(scheduledAt(post({})), null);
    assert.equal(scheduledAt(post({ status: 'published', scheduledAt: '2026-12-01T12:00:00Z' })), null);
  });

  it('fecha y hora en el idioma de la interfaz', () => {
    const iso = new Date(2026, 11, 1, 9, 5).toISOString();
    assert.equal(scheduledLabel(iso, i18nFor('es')), 'Programado · 1 dic 2026, 09:05');
    assert.equal(scheduledLabel(iso, i18nFor('en')), 'Scheduled · Dec 1, 2026, 9:05 AM');
  });
});

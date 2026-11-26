import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullYearsBetween, rank, streaks, topLanguages, TROPHIES } from '../src/metrics.ts';

describe('streaks', () => {
  it('cuenta la racha actual hasta hoy y la más larga, con sus fechas', () => {
    const days = { '2026-01-01': 1, '2026-01-02': 3, '2026-01-03': 2, '2026-01-05': 1, '2026-01-06': 4 };
    assert.deepEqual(streaks(days, '2026-01-06'), {
      total: 11,
      current: { days: 2, start: '2026-01-05', end: '2026-01-06' },
      longest: { days: 3, start: '2026-01-01', end: '2026-01-03' },
    });
  });

  it('hoy sin contribuciones no corta la racha (el día no terminó); ayer sin contribuciones, sí', () => {
    const days = { '2026-03-30': 1, '2026-03-31': 1 };
    assert.deepEqual(streaks(days, '2026-04-01').current, { days: 2, start: '2026-03-30', end: '2026-03-31' });
    assert.deepEqual(streaks(days, '2026-04-02').current, { days: 0 });
  });

  it('sin contribuciones: todo en cero y sin fechas', () => {
    assert.deepEqual(streaks({}, '2026-01-01'), { total: 0, current: { days: 0 }, longest: { days: 0 } });
  });

  it('ignora días con 0 y fechas futuras', () => {
    const days = { '2026-01-01': 0, '2026-01-02': 2, '2026-01-09': 5 };
    assert.deepEqual(streaks(days, '2026-01-02'), {
      total: 2,
      current: { days: 1, start: '2026-01-02', end: '2026-01-02' },
      longest: { days: 1, start: '2026-01-02', end: '2026-01-02' },
    });
  });
});

describe('topLanguages', () => {
  it('ordena por bytes, calcula la proporción y agrupa el resto en "Other"', () => {
    const result = topLanguages({ Go: 100, TypeScript: 500, CSS: 50, 'C#': 300, HTML: 50 }, 3);
    assert.deepEqual(result, [
      { name: 'TypeScript', share: 0.5 },
      { name: 'C#', share: 0.3 },
      { name: 'Go', share: 0.1 },
      { name: 'Other', share: 0.1 },
    ]);
  });

  it('sin "Other" cuando entran todos, y vacío sin bytes', () => {
    assert.deepEqual(topLanguages({ Rust: 1, C: 3 }, 6), [{ name: 'C', share: 0.75 }, { name: 'Rust', share: 0.25 }]);
    assert.deepEqual(topLanguages({}, 6), []);
  });
});

describe('rank', () => {
  const thresholds = [1, 10, 50, 100, 250, 500] as const;

  it('sin llegar al primer umbral no hay rango; el progreso es hacia el primero', () => {
    assert.deepEqual(rank(0, thresholds), { tier: null, next: 1, progress: 0 });
  });

  it('en cada umbral sube de rango y mide el progreso hacia el siguiente', () => {
    assert.deepEqual(rank(1, thresholds), { tier: 'C', next: 10, progress: 0 });
    assert.deepEqual(rank(30, thresholds), { tier: 'B', next: 50, progress: 0.5 });
    assert.deepEqual(rank(250, thresholds), { tier: 'AAA', next: 500, progress: 0 });
  });

  it('el último rango no tiene siguiente y el progreso queda completo', () => {
    assert.deepEqual(rank(9000, thresholds), { tier: 'S', next: null, progress: 1 });
  });

  it('cada trofeo tiene 6 umbrales estrictamente crecientes desde 1', () => {
    assert.deepEqual(TROPHIES.map((t) => t.key), ['stars', 'commits', 'pullRequests', 'issues', 'repos', 'followers', 'years']);
    for (const trophy of TROPHIES) {
      assert.equal(trophy.thresholds.length, 6, trophy.key);
      assert.equal(trophy.thresholds[0], 1, trophy.key);
      for (let i = 1; i < 6; i++) assert.ok(trophy.thresholds[i]! > trophy.thresholds[i - 1]!, trophy.key);
    }
  });
});

describe('fullYearsBetween', () => {
  it('cuenta años completos (el aniversario cuenta desde ese día)', () => {
    assert.equal(fullYearsBetween('2019-03-14T10:00:00Z', '2026-03-13T23:59:59Z'), 6);
    assert.equal(fullYearsBetween('2019-03-14T10:00:00Z', '2026-03-14T00:00:00Z'), 7);
    assert.equal(fullYearsBetween('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'), 0);
  });
});

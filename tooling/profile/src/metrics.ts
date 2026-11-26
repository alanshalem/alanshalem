import type { ProfileData } from './model.ts';

/** Cálculos sobre los datos públicos del perfil. Puros: no leen el reloj ni la red. */

export const DAY = 86_400_000;
const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY;

export interface Run {
  days: number;
  start?: string;
  end?: string;
}

export interface Streaks {
  total: number;
  current: Run;
  longest: Run;
}

/**
 * Racha actual y más larga de días seguidos con contribuciones. Hoy sin contribuciones no corta la racha actual
 * (el día todavía no terminó); ayer sin contribuciones, sí.
 */
export function streaks(contributions: Record<string, number>, today: string): Streaks {
  const active = Object.entries(contributions)
    .filter(([date, count]) => count > 0 && date <= today)
    .map(([date]) => date)
    .sort();
  const total = active.reduce((sum, date) => sum + contributions[date]!, 0);

  const runs: Required<Run>[] = [];
  for (const date of active) {
    const last = runs.at(-1);
    if (last && dayNumber(date) - dayNumber(last.end) === 1) {
      last.end = date;
      last.days++;
    } else {
      runs.push({ days: 1, start: date, end: date });
    }
  }

  const latest = runs.at(-1);
  const current = latest && dayNumber(today) - dayNumber(latest.end) <= 1 ? latest : { days: 0 };
  // Ante un empate gana la primera: la racha más larga no "se mueve" cuando otra la iguala.
  const longest = runs.reduce<Run>((best, run) => (run.days > best.days ? run : best), { days: 0 });
  return { total, current: { ...current }, longest: { ...longest } };
}

export interface LanguageShare {
  name: string;
  share: number;
}

/** Los `limit` lenguajes con más bytes y el resto sumado como "Other", en proporción del total. */
export function topLanguages(bytes: Record<string, number>, limit: number): LanguageShare[] {
  const sorted = Object.entries(bytes).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const total = sorted.reduce((sum, [, size]) => sum + size, 0);
  if (total === 0) return [];
  const top = sorted.slice(0, limit).map(([name, size]) => ({ name, share: size / total }));
  const rest = sorted.slice(limit).reduce((sum, [, size]) => sum + size, 0);
  return rest > 0 ? [...top, { name: 'Other', share: rest / total }] : top;
}

/** Años completos entre dos instantes: el aniversario cuenta desde ese día, sin mirar la hora. */
export function fullYearsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((iso) => new Date(iso).toISOString().slice(0, 10));
  const years = Number(b!.slice(0, 4)) - Number(a!.slice(0, 4));
  return b!.slice(5) < a!.slice(5) ? years - 1 : years;
}

export const TIERS = ['C', 'B', 'A', 'AA', 'AAA', 'S'] as const;
export type Tier = (typeof TIERS)[number];

export interface Rank {
  /** null: todavía no llegó al primer umbral. */
  tier: Tier | null;
  /** Valor del próximo rango; null en el último. */
  next: number | null;
  /** Avance de 0 a 1 desde el rango actual hasta el próximo. */
  progress: number;
}

/** Rango según umbrales crecientes, uno por cada nivel de TIERS. */
export function rank(value: number, thresholds: readonly number[]): Rank {
  const reached = thresholds.filter((t) => value >= t).length;
  const floor = reached === 0 ? 0 : thresholds[reached - 1]!;
  const next = thresholds[reached] ?? null;
  return {
    tier: reached === 0 ? null : TIERS[reached - 1]!,
    next,
    progress: next === null ? 1 : (value - floor) / (next - floor),
  };
}

export interface Trophy {
  key: string;
  /** Corto: entra en una baldosa de la fila de trofeos. */
  label: string;
  value: (data: ProfileData) => number;
  thresholds: readonly number[];
}

/**
 * Trofeos calculados acá, sin servicios externos. Umbrales pensados para un perfil personal: el primer nivel se
 * alcanza con la primera contribución de cada tipo y el último pide constancia de años (commits: del último año).
 */
export const TROPHIES: readonly Trophy[] = [
  { key: 'stars', label: 'Stars', value: (d) => d.stars, thresholds: [1, 10, 30, 60, 100, 200] },
  { key: 'commits', label: 'Commits', value: (d) => d.commitsLastYear, thresholds: [1, 100, 250, 500, 1000, 2000] },
  { key: 'pullRequests', label: 'PRs', value: (d) => d.pullRequests, thresholds: [1, 10, 25, 50, 100, 200] },
  { key: 'issues', label: 'Issues', value: (d) => d.issues, thresholds: [1, 10, 25, 50, 100, 200] },
  { key: 'repos', label: 'Repos', value: (d) => d.repos, thresholds: [1, 10, 20, 30, 50, 100] },
  { key: 'followers', label: 'Followers', value: (d) => d.followers, thresholds: [1, 10, 25, 50, 100, 200] },
  { key: 'years', label: 'Years', value: (d) => fullYearsBetween(d.createdAt, d.fetchedAt), thresholds: [1, 2, 3, 5, 7, 10] },
];

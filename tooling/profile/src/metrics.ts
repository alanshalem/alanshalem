import type { ProfileData } from './model.ts';

/** Calculations over the profile's public data. Pure: they read neither the clock nor the network. */

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
 * Current and longest streak of consecutive days with contributions. Today without contributions does not break the
 * current streak (the day is not over yet); yesterday without contributions does.
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
  // On a tie the first one wins: the longest streak does not "move" when another one equals it.
  const longest = runs.reduce<Run>((best, run) => (run.days > best.days ? run : best), { days: 0 });
  return { total, current: { ...current }, longest: { ...longest } };
}

export interface LanguageShare {
  name: string;
  share: number;
}

/** The `limit` languages with the most bytes and the rest summed as "Other", as shares of the total. */
export function topLanguages(bytes: Record<string, number>, limit: number): LanguageShare[] {
  const sorted = Object.entries(bytes).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const total = sorted.reduce((sum, [, size]) => sum + size, 0);
  if (total === 0) return [];
  const top = sorted.slice(0, limit).map(([name, size]) => ({ name, share: size / total }));
  const rest = sorted.slice(limit).reduce((sum, [, size]) => sum + size, 0);
  return rest > 0 ? [...top, { name: 'Other', share: rest / total }] : top;
}

/** Full years between two instants: the anniversary counts from that day on, regardless of the time. */
export function fullYearsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((iso) => new Date(iso).toISOString().slice(0, 10));
  const years = Number(b!.slice(0, 4)) - Number(a!.slice(0, 4));
  return b!.slice(5) < a!.slice(5) ? years - 1 : years;
}

export const TIERS = ['C', 'B', 'A', 'AA', 'AAA', 'S'] as const;
export type Tier = (typeof TIERS)[number];

export interface Rank {
  /** null: the first threshold is not reached yet. */
  tier: Tier | null;
  /** Value of the next rank; null on the last one. */
  next: number | null;
  /** Progress from 0 to 1 from the current rank to the next one. */
  progress: number;
}

/** Rank by increasing thresholds, one per TIERS level. */
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
  /** Short: it fits in one tile of the trophy row. */
  label: string;
  value: (data: ProfileData) => number;
  thresholds: readonly number[];
}

/**
 * Trophies computed here, without external services. Thresholds meant for a personal profile: the first level is
 * reached with the first contribution of each kind and the last one takes years of consistency (commits: last year's).
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
